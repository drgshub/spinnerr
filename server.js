import express from "express";
import { execSync } from "child_process";
import httpProxy from "http-proxy";
import path from "path";
import fs from "fs";
import containerRoutes from "./routes/containerRoutes.js"; 
import groupRoutes from "./routes/groupRoutes.js";


const app = express();
///const proxy = httpProxy.createProxyServer({});
const waitingPage = path.join("/app/public", "waiting.html");
const config = JSON.parse(fs.readFileSync("/app/config/config.json"));
const PORT = process.env.PORT || config.port
let containers = config.containers;
let groups = config.groups;

const lastActivity = {};
containers.forEach(c => lastActivity[c.name] = Date.now());

const proxy = httpProxy.createProxyServer({
  ws: true,
  changeOrigin: true
});

// WebSocket fix
proxy.on("proxyReq", (proxyReq, req, res) => {
  if (req.headers.upgrade) {
    proxyReq.setHeader("Connection", "Upgrade");
    proxyReq.setHeader("Upgrade", req.headers.upgrade);
  }
});


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
// Get all containers from Docker
//----------------------------------------------------------------
function allContainers() {
  if (HAS_SOCKET) {
    try {
      const output = execSync(`docker ps -a --format '{{.Names}}'`).toString().trim();
      return output.split('\n');
    } catch {
      return [];
    }
  } else if (DOCKER_PROXY_URL) {
    try {
      const res = execSync(`curl -s ${DOCKER_PROXY_URL.replace("tcp://", "http://")}/containers/json?all=1`).toString();
      const containers = JSON.parse(res);
      return containers.map(c => c.Names[0].replace(/^\//, ''));
    } catch {
      return [];
    }
  }
  return [];
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
        log(`<${name}> timeout not reached, will stop once timeout reaches ${idleTimeout} seconds from START time and ACTIVATION time`);
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
// Check if container activation is more than timeout ago
//----------------------------------------------------------------
function checkActivationTime(name, idleTimeout){
  const activatedAt = containers.find(c => c.name === name)?.activatedAt;
  if (!activatedAt) return false;

  const now = Date.now();
  return now - activatedAt > idleTimeout * 1000;
}

//----------------------------------------------------------------
// Check if container is part of a group
//----------------------------------------------------------------
function isContainerInGroup(name, groups) {
  for (const g of groups) {
    if (!g.active) continue;
    if (!g.container) continue;

    if (Array.isArray(g.container)) {
      if (g.container.includes(name)) {
        return true;
      }
    } else {
      if (g.container === name) {
        return true;
      }
    }
  }

  return false;
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
//app.use(express.json());
//app.use("/api/containers", containerRoutes);
//app.use("/api/groups", groupRoutes);
app.use("/api/containers", express.json(), containerRoutes);
app.use("/api/groups", express.json(), groupRoutes);
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
ui.use("/api/groups", groupRoutes); // group API routes

// Expose container control utilities to UI routes

ui.locals.isContainerRunning = isContainerRunning;
ui.locals.startContainer = startContainer;
ui.locals.stopContainer = stopContainer;
ui.locals.lastActivity = lastActivity;
ui.locals.allContainers = allContainers;

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

  // Helper: find active group containing this container
  const group = groups.find(g =>
    g.active &&
    g.container &&
    (Array.isArray(g.container)
      ? g.container.includes(container.name)
      : g.container === container.name)
  );

  // If the container is running, redirect to it's webpage, else start the container
  if (isContainerRunning(container.name)) {
    return proxy.web(req, res, { target: container.url });
  } 

  // Not running — must start it (or its group)
  if (container.active) {
    if (group) {
      // Start every container in the group
      const names = Array.isArray(group.container)
        ? group.container
        : [group.container];

      names.forEach(name => {
        if (!isContainerRunning(name)) {
          startContainer(name);
        }
      });

      console.log(`Starting group <${group.name}> because <${container.name}> was accessed`);
    } else {
      // Start single container normally
      startContainer(container.name);
    }
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
  // ─────────────────────────────────────────────
  // INDIVIDUAL CONTAINER TIMEOUT (non-group)
  // ─────────────────────────────────────────────
  containers.forEach(c => {
    if (c.idleTimeout
    && !isContainerInGroup(c.name, groups)
    && c.active && now - lastActivity[c.name] > (c.idleTimeout || 60) * 1000 
    && isContainerRunning(c.name) 
    && checkStartTime(c.name, c.idleTimeout)
    && checkActivationTime(c.name, c.idleTimeout)) {
      log(`<${c.name}> ${(c.idleTimeout || 60)} seconds timeout reached`);
      stopContainer(c.name);
      log(`<${c.name}> stopped successfully`);
      logOnce = true;
    }
  });
  // ─────────────────────────────────────────────
  // GROUP TIMEOUT (stop ALL containers in group)
  // ─────────────────────────────────────────────
  groups.forEach(g => {
    if (!g.active || !g.idleTimeout || !g.container) return;

    const groupContainers = Array.isArray(g.container)
      ? g.container
      : [g.container];

    // Check if ANY container in group exceeds timeout
    const shouldStopGroup = groupContainers.some(name => {
      return (
        isContainerRunning(name) &&
        now - lastActivity[name] > (g.idleTimeout || 60) * 1000 &&
        checkStartTime(name, g.idleTimeout)
      );
    });

    if (shouldStopGroup) {
      log(`Group <${g.name}> timeout reached (${g.idleTimeout}s). Stopping group.`);

      // Stop ALL containers in the group
      groupContainers.forEach(name => {
        if (isContainerRunning(name)) {
          stopContainer(name);
          log(`<${name}> stopped as part of group <${g.name}>`);
        }
      });
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

    groups = newConfig.groups;
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
//app.listen(PORT, () => {
//  log(`Spinnerr Proxy running on port ${PORT}`);
//});

const server = app.listen(PORT, () => {
  log(`Spinnerr Proxy running on port ${PORT}`);
});

server.on("upgrade", (req, socket, head) => {
  const container = containers.find(c => c.host === req.headers.host);
  if (!container) return socket.destroy();
  proxy.ws(req, socket, head, { target: container.url, ws: true, changeOrigin: true, xfwd: true });
});

