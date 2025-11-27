import express from "express";
import { execSync } from "child_process";
import httpProxy from "http-proxy";
import path from "path";
import fs from "fs";
import containerRoutes from "./routes/containerRoutes.js"; 

const app = express();
const proxy = httpProxy.createProxyServer({});
const waitingPage = path.join("/app/public", "waiting.html");
const config = JSON.parse(fs.readFileSync("/app/config/config.json"));
const PORT = process.env.PORT || config.port
let containers = config.containers;

const lastActivity = {};
containers.forEach(c => lastActivity[c.name] = Date.now());


//----------------------------------------------------------------
// Log function
//----------------------------------------------------------------
function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}


//----------------------------------------------------------------
// Check if Proxy or Socket
//----------------------------------------------------------------
const DOCKER_PROXY_URL = process.env.DOCKER_PROXY_URL || null;
const HAS_SOCKET = fs.existsSync("/var/run/docker.sock");
let method;

if(HAS_SOCKET){
  method = "socket";
  log(`Using SOCKET`);
} else if(DOCKER_PROXY_URL){
  method = "proxy";
  log(`Using PROXY`);
} else if (HAS_SOCKET && DOCKER_PROXY_URL){
  log(`Both methods defined, please choose between docker socket or docker proxy`)
} else {
  log(`No socket or proxy found, please mount the docker socket or define a docker proxy`)
}


//----------------------------------------------------------------
// Check if container is running
//----------------------------------------------------------------
function isContainerRunning(name) {
  if (HAS_SOCKET) {
    try {
      const output = execSync(`docker inspect -f '{{.State.Running}}' ${name}`).toString().trim();
      return output === "true";
    } catch {
      return false;
    }
  } else if (DOCKER_PROXY_URL) {
    try {
      const res = execSync(`curl -s ${DOCKER_PROXY_URL.replace("tcp://", "http://")}/containers/${name}/json`).toString();
      return JSON.parse(res).State.Running;
    } catch {
      return false;
    }
  }
  return false;
}


//----------------------------------------------------------------
// Determine container start time in order to prevent stopping earlier if container was started manually
//----------------------------------------------------------------
let logOnce = true;
function checkStartTime(name, idleTimeout){
  
  const now = Date.now();
  let startTimeStr;

  if (HAS_SOCKET) {
    try {
      startTimeStr = execSync(`docker inspect -f '{{.State.StartedAt}}' ${name}`).toString().trim();
    } catch(e) {
      console.error('Error checking container via socket:', e.message);
      return false;
    }
  } else if (DOCKER_PROXY_URL) {
    try {
      const res = execSync(`curl -s ${DOCKER_PROXY_URL.replace("tcp://", "http://")}/containers/${name}/json`).toString().trim();
      const containerInfo = JSON.parse(res);
      startTimeStr = containerInfo.State.StartedAt;
    } catch(e) {
      console.error('Error checking container via proxy:', e.message);
      return false;
    }
  } else {
    return false;
  }

  try {
    const startTime = new Date(startTimeStr).getTime();
    
    if (logOnce){
      log(`<${name}> timeout reached from last web request, checking for timeout from START time`);
      if (!(now - startTime > idleTimeout * 1000)){
        log(`<${name}> timeout not reached, will stop once timeout reaches ${idleTimeout} seconds`);
      }
    }

    logOnce = false;

    return (now - startTime > idleTimeout * 1000);
  } catch(e){
    console.error('Error checking container start time:', e.message);
    return false;
  }
}


//----------------------------------------------------------------
// Start container function
//----------------------------------------------------------------
function startContainer(name) {
  if (!isContainerRunning(name)) {
    try {
      if (HAS_SOCKET){
        execSync(`docker start ${name}`, { stdio: "ignore" });
      } else if (DOCKER_PROXY_URL){
        execSync(`curl -s -X POST ${DOCKER_PROXY_URL.replace("tcp://", "http://")}/containers/${name}/start`);
      }
      log(`<${name}> started`);
    } catch (e) {
      log(`Failed to start ${name}: ${e.message}`);
    }
  }
}


//----------------------------------------------------------------
// Stop container function
//----------------------------------------------------------------
function stopContainer(name) {
  if (isContainerRunning(name)) {
    try {
      log(`<${name}> stopping..`);
      if (HAS_SOCKET){
        execSync(`docker stop ${name}`, { stdio: "ignore" });
      } else if (DOCKER_PROXY_URL){
        execSync(`curl -s -X POST ${DOCKER_PROXY_URL.replace("tcp://", "http://")}/containers/${name}/stop`);
      }
    } catch (e) {
      log(`Failed to stop ${name}: ${e.message}`);
    }
  }
}


//----------------------------------------------------------------
// Expose control functions for backend and UI
//----------------------------------------------------------------
app.use(express.json());
app.use("/api/containers", containerRoutes);

app.locals.startContainer = startContainer;
app.locals.stopContainer = stopContainer;
app.locals.isContainerRunning = isContainerRunning;
app.locals.lastActivity = lastActivity;


//----------------------------------------------------------------
// Web UI server
//----------------------------------------------------------------
const UI_PORT = process.env.UI_PORT || null;

const ui = express();
ui.use(express.json());                     // keep JSON parsing
ui.use("/api/containers", containerRoutes); // container API routes
ui.use(express.static("/app/public/ui"));  // serve HTML/CSS/JS

// Expose container control utilities to UI routes

ui.locals.isContainerRunning = isContainerRunning;
ui.locals.startContainer = startContainer;
ui.locals.stopContainer = stopContainer;
ui.locals.lastActivity = lastActivity;

// Start UI server if defined
if (UI_PORT){ 
  ui.listen(UI_PORT, () => {
    log(`WebUI running on port ${UI_PORT}`);
  });
}


//----------------------------------------------------------------
// Main proxy middleware
//----------------------------------------------------------------
app.use(async (req, res, next) => {
  const container = containers.find(c => c.host === req.hostname);
  if (!container) return res.status(404).send("Container not found");

  // Update the timestamp when the container was last accessed via web requests
  lastActivity[container.name] = Date.now(); 

  // If the container is running, redirect to it's webpage, else start the container
  if (isContainerRunning(container.name)) {
    return proxy.web(req, res, { target: container.url });
  } else if (container.active){
    startContainer(container.name);
  }

  // If the service endpoint is reachable, serve the webpage; else serve the waiting page until ready
  try {
    const r = await fetch(`${container.url}/health`, { method: "GET" });
    if (r.ok) {
      return proxy.web(req, res, { target: container.url });
    }
  } catch {}

  res.sendFile(waitingPage);
});


//----------------------------------------------------------------
// Tracking the timeout
//----------------------------------------------------------------
const lastLog = {}; // track last log time per container

proxy.on('proxyRes', (proxyRes, req) => {
  const container = containers.find(c => c.host === req.hostname);
  if (!container) return;

  lastActivity[container.name] = Date.now();

  const now = Date.now();
  if (!lastLog[container.name] || now - lastLog[container.name] > 5000) { // 5000 ms = 5 sec
    log(`<${container.name}> accessed on ${new Date(lastActivity[container.name]).toISOString()}, timeout reset`);
    lastLog[container.name] = now;
  }
});


//----------------------------------------------------------------
// Check every 5 seconds if timeout has been reached
//----------------------------------------------------------------
setInterval(() => {
  const now = Date.now();
  containers.forEach(c => {
    if (c.active && now - lastActivity[c.name] > (c.idleTimeout || 60) * 1000 && isContainerRunning(c.name) && checkStartTime(c.name, c.idleTimeout)) {
      log(`<${c.name}> ${(c.idleTimeout || 60)} seconds timeout reached`);
      stopContainer(c.name);
      log(`<${c.name}> stopped successfully`);
      logOnce = true;
    }
  });
}, 5000);

//----------------------------------------------------------------
// Reload configuration function
//----------------------------------------------------------------
function reloadConfig() {
  try {
    const newConfig = JSON.parse(fs.readFileSync("/app/config/config.json"));
    
    // Merge lastActivity for existing containers
    newConfig.containers.forEach(c => {
      if (lastActivity[c.name] === undefined) {
        lastActivity[c.name] = Date.now();
      }
    });

    containers = newConfig.containers;
    log("Config reloaded, containers updated");
  } catch (e) {
    log(`Failed to reload config: ${e.message}`);
  }
}

//----------------------------------------------------------------
// Reload configuration if config.json has been changed
//----------------------------------------------------------------

fs.watchFile("/app/config/config.json", { interval: 500 }, () => {
  reloadConfig();
});

//----------------------------------------------------------------
// Main app, starts the app listening on the defined port
//----------------------------------------------------------------
app.listen(PORT, () => {
  log(`Spinnerr Proxy running on port ${PORT}`);
});
