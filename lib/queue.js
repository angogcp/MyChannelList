const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { EventEmitter } = require("events");

function createDownloadQueue(options = {}) {
  const dataRoot = options.dataRoot || process.cwd();
  const downloader = options.downloader;
  const drive = options.drive;
  
  if (!downloader || !drive) {
    throw new Error("Downloader and Drive instances are required for the queue.");
  }

  const queueFile = path.join(dataRoot, "queue.json");
  const MAX_CONCURRENT = 2; // Can be tweaked
  
  let jobs = new Map();
  let activeCount = 0;
  let running = false;
  
  const emitter = new EventEmitter();

  const api = {
    addJob,
    getQueueState,
    clearCompleted,
    cancelJob,
    on: emitter.on.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),
    off: emitter.off.bind(emitter),
    start
  };

  return api;

  async function start() {
    await loadQueue();
    running = true;
    processNext();
  }

  async function loadQueue() {
    try {
      const data = await fsp.readFile(queueFile, "utf-8");
      const list = JSON.parse(data);
      for (const job of list) {
        // If a job was processing when the server crashed, reset it to pending
        if (job.status === "processing" || job.status === "uploading") {
          job.status = "pending";
          job.message = "Resumed after server restart. Waiting in queue...";
          job.percent = 0;
        }
        jobs.set(job.id, job);
      }
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.error("Failed to load queue:", err);
      }
    }
  }

  async function saveQueue() {
    try {
      const list = Array.from(jobs.values());
      // limit keeping history to, say, last 50 completed/error jobs to prevent endless growth
      const pending = list.filter(j => j.status === "pending" || j.status === "processing" || j.status === "uploading");
      const done = list.filter(j => j.status === "done" || j.status === "error")
                       .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
                       .slice(0, 50);
      
      const payload = [...pending, ...done];
      await fsp.mkdir(path.dirname(queueFile), { recursive: true });
      await fsp.writeFile(queueFile, JSON.stringify(payload, null, 2), "utf-8");
    } catch (err) {
      console.error("Failed to save queue:", err);
    }
  }

  function broadcast() {
    emitter.emit("update", getQueueState());
    saveQueue(); // Fire-and-forget save whenever queue changes meaningfully
  }

  function getQueueState() {
    const list = Array.from(jobs.values());
    // Sort logic: processing first, then pending (oldest first), then done (newest first)
    const active = list.filter(j => j.status === "processing" || j.status === "uploading" || j.status === "pending");
    const inactive = list.filter(j => j.status === "done" || j.status === "error");
    
    active.sort((a, b) => {
      // Prioritize running jobs over pending
      if (a.status !== b.status) {
        if (a.status === "processing" || a.status === "uploading") return -1;
        if (b.status === "processing" || b.status === "uploading") return 1;
      }
      return a.createdAt - b.createdAt;
    });

    inactive.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

    return [...active, ...inactive.slice(0, 10)]; // send top active and recent history to frontend
  }

  function addJob(payload) {
    const id = crypto.randomUUID();
    const job = {
      id,
      url: payload.url,
      mode: payload.mode || "video",
      customName: payload.customName || "",
      quality: payload.quality || "",
      uploadToDrive: !!payload.uploadToDrive,
      driveFolderId: payload.driveFolderId || "",
      deleteLocalAfterUpload: !!payload.deleteLocalAfterUpload,
      
      status: "pending", // pending, processing, uploading, done, error
      percent: 0,
      message: "Waiting in queue...",
      createdAt: Date.now(),
      
      title: payload.title || payload.url
    };
    
    jobs.set(id, job);
    broadcast();
    processNext();
    
    return { id, message: "Job added to queue." };
  }

  function clearCompleted() {
    for (const [id, job] of jobs.entries()) {
      if (job.status === "done" || job.status === "error") {
        jobs.delete(id);
      }
    }
    broadcast();
  }

  function cancelJob(id) {
    const job = jobs.get(id);
    if (!job) return false;
    
    if (job.status === "pending") {
      jobs.delete(id);
      broadcast();
      return true;
    }
    
    // We don't support hard killing yt-dlp child processes in this simple queue, 
    // so active jobs can't easily be cancelled.
    return false;
  }

  async function processNext() {
    if (!running || activeCount >= MAX_CONCURRENT) {
      return;
    }

    const pendingJobs = Array.from(jobs.values()).filter(j => j.status === "pending").sort((a, b) => a.createdAt - b.createdAt);
    if (pendingJobs.length === 0) {
      return;
    }

    const job = pendingJobs[0];
    activeCount++;
    job.status = "processing";
    job.message = "Initializing download...";
    broadcast();
    
    // Attempt another in case we have capacity
    processNext();

    try {
      const result = await downloader.download({
        url: job.url,
        mode: job.mode,
        customName: job.customName,
        quality: job.quality,
        onProgress: (prog) => {
          if (prog.type === "progress") {
            job.percent = prog.percent;
            job.message = prog.message;
            // Throttle broadcasts slightly to prevent SSE flooding if yt-dlp spits out lines insanely fast
            // A simple broadcast is usually fine unless 100fps output
            broadcast();
          } else if (prog.type === "processing" || prog.type === "destination") {
            job.message = prog.message;
            if (prog.filePath && !job.filePath) {
              job.filePath = prog.filePath; // Capture filename early if known
              job.title = path.basename(prog.filePath); // Update title to actual filename
            }
            broadcast();
          }
        }
      });
      
      job.filePath = result.filePath || job.filePath;
      job.title = job.filePath ? path.basename(job.filePath) : job.title;

      if (job.uploadToDrive) {
        job.status = "uploading";
        job.message = "Uploading to Google Drive...";
        job.percent = 100; // local download is done
        broadcast();

        const driveResult = await drive.uploadFile({
          filePath: result.filePath,
          folderId: job.driveFolderId,
          deleteLocal: job.deleteLocalAfterUpload
        });

        job.status = "done";
        job.message = job.deleteLocalAfterUpload 
            ? "Uploaded to Drive. Local file removed." 
            : `Saved locally and uploaded to Drive.\nDrive File: ${driveResult.name}`;
        job.driveLink = driveResult.webViewLink;
      } else {
        job.status = "done";
        job.message = "Download completed successfully.";
      }
      
    } catch (err) {
      job.status = "error";
      job.message = err.message || "An unknown error occurred.";
    } finally {
      job.completedAt = Date.now();
      activeCount--;
      broadcast();
      processNext(); // Trigger next after finishing
    }
  }
}

module.exports = {
  createDownloadQueue
};
