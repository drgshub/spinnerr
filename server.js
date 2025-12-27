import express from "express";
import { execSync, exec } from "child_process";
import httpProxy from "http-proxy";
import path from "path";
import fs from "fs";
import containerRoutes from "./routes/containerRoutes.js"; 
import groupRoutes from "./routes/groupRoutes.js";
import scheduleRoutes from "./routes/scheduleRoutes.js";
import apiKeyRoutes from "./routes/apiKeyRoutes.js";
import https from "https";

//----------------------------------------------------------------
// Constants and Configuration
//----------------------------------------------------------------
const CONFIG_PATH = "/app/config/config.json";
const WAITING_PAGE = path.join("/app/public", "waiting.html");
const PORT = process.env.PORT || 10000;
const UI_PORT = process.env.UI_PORT || null;
const DOCKER_PROXY_URL = process.env.DOCKER_PROXY_URL || null;
const HAS_SOCKET = fs.existsSync("/var/run/docker.sock");

//----------------------------------------------------------------
// Log function
//----------------------------------------------------------------
function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

//----------------------------------------------------------------
// Load configuration
//----------------------------------------------------------------
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaultConfig = {
      containers: [],
      order: [],
      groups: [],
      groupOrder: [],
      schedules: [],
      apiKeys: { pve: {} }
    };
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
    log("No config.json found — created default config");
    return defaultConfig;
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH));
}

//----------------------------------------------------------------
// Initialize application state
//----------------------------------------------------------------
const config = loadConfig();
let containers = config.containers;
let groups = config.groups;
let schedules = config.schedules || [];
let apiKeys = config.apiKeys || {};

const lastActivity = {};
const stoppingContainers = new Set();
const recentlyStarted = new Map();
const lastLog = {};
const logOnce = {};

// Initialize lastActivity timestamps
containers.forEach(c => lastActivity[c.name] = Date.now());

//----------------------------------------------------------------
// Setup Docker connection method
//----------------------------------------------------------------
let dockerMethod = "none";
if (HAS_SOCKET && DOCKER_PROXY_URL) {
  dockerMethod = "proxy";
  log("Both socket and proxy defined, defaulted to PROXY");
} else if (HAS_SOCKET) {
  dockerMethod = "socket";
  log("Using SOCKET");
} else if (DOCKER_PROXY_URL) {
  dockerMethod = "proxy";
  log("Using PROXY");
} else {
  log("No socket or proxy found, please mount the docker socket or define a docker proxy");
}

//----------------------------------------------------------------
// Proxmox Configuration
//----------------------------------------------------------------
const pveKeys = config.apiKeys?.pve || {};
const pveHostname = pveKeys?.hostname || null;
const pvePort = pveKeys?.port || null;
const pveNode = pveKeys?.node || null;
const pveUser = pveKeys?.user || null;
const pveTokenId = pveKeys?.tokenId || null;
const pveToken = pveKeys?.token || null;
const pveAuthHeader = pveUser && pveTokenId && pveToken 
  ? `PVEAPIToken=${pveUser}!${pveTokenId}=${pveToken}` 
  : null;

if (pveAuthHeader) {
  log(`PVE Config: SET - ${pveHostname}:${pvePort}, node: ${pveNode}`);
} else {
  log("PVE Config: NOT SET");
}

//----------------------------------------------------------------
// Docker Functions
//----------------------------------------------------------------
async function executeDockerCommand(command, isSocket = false) {
  return new Promise((resolve) => {
    exec(command, { timeout: 3000 }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout?.toString().trim(), stderr });
    });
  });
}

async function isContainerRunningDocker(name) {
  if (dockerMethod === "socket") {
    const { stdout } = await executeDockerCommand(`docker inspect -f '{{.State.Running}}' ${name}`);
    return stdout === "true";
  } else if (dockerMethod === "proxy") {
    try {
      const res = await fetch(
        `${DOCKER_PROXY_URL.replace("tcp://", "http://")}/containers/${name}/json`,
        { signal: AbortSignal.timeout(3000) }
      );
      const data = await res.json();
      return data.State.Running;
    } catch {
      return false;
    }
  }
  return false;
}

async function allContainersDocker() {
  if (dockerMethod === "socket") {
    const { stdout } = await executeDockerCommand("docker ps -a --format '{{.Names}}'");
    return stdout ? stdout.split('\n').filter(Boolean) : [];
  } else if (dockerMethod === "proxy") {
    try {
      const res = await fetch(
        `${DOCKER_PROXY_URL.replace("tcp://", "http://")}/containers/json?all=1`,
        { signal: AbortSignal.timeout(3000) }
      );
      const containers = await res.json();
      return containers.map(c => c.Names[0].replace(/^\//, ''));
    } catch {
      return [];
    }
  }
  return [];
}

async function checkStartTimeDocker(name, idleTimeout) {
  const now = Date.now();
  let startTimeStr;

  try {
    if (dockerMethod === "socket") {
      startTimeStr = execSync(`docker inspect -f '{{.State.StartedAt}}' ${name}`).toString().trim();
    } else if (dockerMethod === "proxy") {
      const res = execSync(`curl -s ${DOCKER_PROXY_URL.replace("tcp://", "http://")}/containers/${name}/json`).toString().trim();
      const containerInfo = JSON.parse(res);
      startTimeStr = containerInfo.State.StartedAt;
    } else {
      return false;
    }

    const startTime = new Date(startTimeStr).getTime();
    
    if (!logOnce[name]) {
      log(`<${name}> checking start time (${idleTimeout}s timeout)`);
      if (!(now - startTime > idleTimeout * 1000)) {
        log(`<${name}> will stop once timeout reaches from start time`);
      }
      logOnce[name] = true;
    }

    return now - startTime > idleTimeout * 1000;
  } catch (e) {
    log(`Error checking start time for ${name}: ${e.message}`);
    return false;
  }
}

async function startContainerDocker(name) {
  if (await isContainerRunning(name)) return;

  try {
    if (dockerMethod === "socket") {
      await executeDockerCommand(`docker start ${name}`, true);
    } else if (dockerMethod === "proxy") {
      await executeDockerCommand(`curl -s -X POST ${DOCKER_PROXY_URL.replace("tcp://", "http://")}/containers/${name}/start`, true);
    }
    log(`<${name}> started`);
  } catch (e) {
    log(`Failed to start ${name}: ${e.message}`);
  }
}

async function stopContainerDocker(name) {
  if (!(await isContainerRunning(name))) return;

  try {
    log(`<${name}> stopping..`);
    if (dockerMethod === "socket") {
      await executeDockerCommand(`docker stop ${name}`, true);
    } else if (dockerMethod === "proxy") {
      await executeDockerCommand(`curl -s -X POST ${DOCKER_PROXY_URL.replace("tcp://", "http://")}/containers/${name}/stop`, true);
    }
  } catch (e) {
    log(`Failed to stop ${name}: ${e.message}`);
  }
}

//----------------------------------------------------------------
// Proxmox LXC Functions
//----------------------------------------------------------------
async function makeProxmoxRequest(path, method = 'GET', body = null) {
  if (!pveAuthHeader) return null;

  return new Promise((resolve) => {
    const options = {
      hostname: pveHostname,
      port: pvePort,
      path: `/api2/json${path}`,
      method,
      headers: {
        'Authorization': pveAuthHeader,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      rejectUnauthorized: false,
      timeout: 5000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function isContainerRunningLXC(fullName) {
  const vmid = extractVmidFromLXCName(fullName);
  if (!vmid) return false;

  const response = await makeProxmoxRequest(`/nodes/${pveNode}/lxc/${vmid}/status/current`);
  if (!response?.data) return false;

  const { data } = response;
  return data.status === 'running' || data.State?.Running === true;
}

async function allContainersLXC() {
  const response = await makeProxmoxRequest(`/nodes/${pveNode}/lxc`);
  if (!response?.data) return [];

  return response.data.map(c => `${c.name}:${c.vmid}@${pveNode}`);
}

async function checkStartTimeLXC(fullName, idleTimeout) {
  const vmid = extractVmidFromLXCName(fullName);
  if (!vmid) return false;

  const response = await makeProxmoxRequest(`/nodes/${pveNode}/lxc/${vmid}/status/current`);
  if (!response?.data) return false;

  const uptime = response.data.uptime || 0;
  const startTime = Date.now() - (uptime * 1000);
  
  if (!logOnce[fullName]) {
    log(`LXC <${fullName}> uptime: ${uptime}s`);
    logOnce[fullName] = true;
  }

  return Date.now() - startTime > idleTimeout * 1000;
}

async function startContainerLXC(fullName) {
  const vmid = extractVmidFromLXCName(fullName);
  if (!vmid) return false;

  const response = await makeProxmoxRequest(`/nodes/${pveNode}/lxc/${vmid}/status/start`, 'POST');
  if (!response || response.error) return false;

  // Wait for container to start
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await isContainerRunningLXC(fullName)) {
      log(`LXC ${fullName} started`);
      return true;
    }
  }
  
  log(`LXC ${fullName} start timeout`);
  return false;
}

async function stopContainerLXC(fullName) {
  const vmid = extractVmidFromLXCName(fullName);
  if (!vmid) return false;

  const response = await makeProxmoxRequest(`/nodes/${pveNode}/lxc/${vmid}/status/shutdown`, 'POST');
  if (!response || response.error) return false;

  // Wait for container to stop
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (!(await isContainerRunningLXC(fullName))) {
      log(`LXC ${fullName} stopped`);
      return true;
    }
  }
  
  log(`LXC ${fullName} shutdown timeout`);
  return false;
}

function extractVmidFromLXCName(fullName) {
  const parts = fullName.split(':');
  if (parts.length !== 2) return null;
  
  const vmidNodePart = parts[1];
  const vmidNodeParts = vmidNodePart.split('@');
  if (vmidNodeParts.length !== 2) return null;
  
  const vmid = vmidNodeParts[0];
  return vmid && !isNaN(parseInt(vmid)) ? vmid : null;
}

//----------------------------------------------------------------
// Combined Functions (Docker + Proxmox LXC)
//----------------------------------------------------------------
function isLXCContainer(name) {
  return name.includes(':') && name.includes('@');
}

async function isContainerRunning(name) {
  return isLXCContainer(name) 
    ? isContainerRunningLXC(name)
    : isContainerRunningDocker(name);
}

async function allContainers() {
  const results = new Set();
  
  const dockerContainers = await allContainersDocker();
  dockerContainers.forEach(c => results.add(c));
  
  if (pveAuthHeader) {
    const lxcContainers = await allContainersLXC();
    lxcContainers.forEach(c => results.add(c));
  }

  return Array.from(results);
}

async function checkStartTime(name, idleTimeout) {
  return isLXCContainer(name)
    ? checkStartTimeLXC(name, idleTimeout)
    : checkStartTimeDocker(name, idleTimeout);
}

async function startContainer(name) {
  return isLXCContainer(name)
    ? startContainerLXC(name)
    : startContainerDocker(name);
}

async function stopContainer(name) {
  return isLXCContainer(name)
    ? stopContainerLXC(name)
    : stopContainerDocker(name);
}

async function checkMultipleContainers(containerNames, maxConcurrent = 10) {
  const results = {};
  
  for (let i = 0; i < containerNames.length; i += maxConcurrent) {
    const batch = containerNames.slice(i, i + maxConcurrent);
    const promises = batch.map(async (name) => {
      try {
        results[name] = await isContainerRunning(name);
      } catch {
        results[name] = false;
      }
    });
    await Promise.all(promises);
  }
  
  return results;
}

//----------------------------------------------------------------
// Utility Functions
//----------------------------------------------------------------
function checkActivationTime(name, idleTimeout) {
  const activatedAt = containers.find(c => c.name === name)?.activatedAt;
  return activatedAt ? Date.now() - activatedAt > idleTimeout * 1000 : false;
}

function isContainerInGroup(name, groups) {
  return groups.some(g => 
    g.active && 
    g.container && 
    (Array.isArray(g.container) ? g.container.includes(name) : g.container === name)
  );
}

//----------------------------------------------------------------
// Create proxy server
//----------------------------------------------------------------
const proxy = httpProxy.createProxyServer({
  ws: true,
  changeOrigin: false
});

proxy.on("proxyReq", (proxyReq, req) => {
  if (req.headers.upgrade) {
    proxyReq.setHeader("Connection", "Upgrade");
    proxyReq.setHeader("Upgrade", req.headers.upgrade);
  }
});

proxy.on("error", (err, req, res) => {
  const container = containers.find(c => c.host === req.hostname);
  
  if (container) {
    const startedAt = recentlyStarted.get(container.name);
    if ((err.code === 'ECONNREFUSED' || err.code === 'EAI_AGAIN') && 
        startedAt && Date.now() - startedAt < 15000) {
    } else {
      log(`<${container.name}> proxy error: ${err.code || err.message}`);
    }
  }

  if (res?.writeHead && !res.headersSent) {
    res.status(502).sendFile(WAITING_PAGE);
  }
});

proxy.on('proxyRes', (proxyRes, req) => {
  const container = containers.find(c => c.host === req.hostname);
  if (!container) return;

  lastActivity[container.name] = Date.now();
  const now = Date.now();
  
  if (!lastLog[container.name] || now - lastLog[container.name] > 5000) {
    log(`<${container.name}> accessed, timeout reset`);
    lastLog[container.name] = now;
  }
});

//----------------------------------------------------------------
// Express App Setup
//----------------------------------------------------------------
const app = express();

// API Routes
app.use("/api/containers", express.json(), containerRoutes);
app.use("/api/groups", express.json(), groupRoutes);
app.use("/api/schedules", express.json(), scheduleRoutes);

// Expose control functions
app.locals.startContainer = startContainer;
app.locals.stopContainer = stopContainer;
app.locals.isContainerRunning = isContainerRunning;
app.locals.lastActivity = lastActivity;

//----------------------------------------------------------------
// Main proxy middleware
//----------------------------------------------------------------
app.use(async (req, res, next) => {
  const container = containers.find(c => c.host === req.hostname);
  if (!container) return res.status(404).send("Container not found");

  lastActivity[container.name] = Date.now();

  // Find active group containing this container
  const group = groups.find(g =>
    g.active &&
    g.container &&
    (Array.isArray(g.container)
      ? g.container.includes(container.name)
      : g.container === container.name)
  );

  // If container is running, proxy request
  if (await isContainerRunning(container.name)) {
    return proxy.web(req, res, { 
      target: container.url, 
      secure: false, 
      changeOrigin: false 
    });
  }

  // Send waiting page and start container
  res.sendFile(WAITING_PAGE);

  if (container.active) {
    if (await isContainerRunning(container.name) || recentlyStarted.has(container.name)) return;

    recentlyStarted.set(container.name, Date.now());
    setTimeout(() => recentlyStarted.delete(container.name), 30000);

    if (group) {
      const names = Array.isArray(group.container) ? group.container : [group.container];
      
      for (const name of names) {
        const containerInGroup = containers.find(c => c.name === name);
        if (!containerInGroup?.active) {
          log(`<${name}> in group <${group.name}> is not active, skipping`);
          continue;
        }
        if (!(await isContainerRunning(name))) {
          await startContainer(name);
        }
      }
      log(`<${container.name}> was accessed, starting group <${group.name}>`);
    } else {
      await startContainer(container.name);
    }
  }
});

//----------------------------------------------------------------
// Timeout handling interval
//----------------------------------------------------------------
setInterval(async () => {
  try {
    const now = Date.now();
    const containerStatus = await checkMultipleContainers(containers.map(c => c.name));
    
    // Individual container timeout
    for (const c of containers) {
      if (!c.active || !c.idleTimeout || isContainerInGroup(c.name, groups)) continue;
      
      const isRunning = containerStatus[c.name];
      const timeoutReached = now - lastActivity[c.name] > (c.idleTimeout || 60) * 1000;
      const activationTimeOk = checkActivationTime(c.name, c.idleTimeout);
      
      if (isRunning && timeoutReached && 
          (await checkStartTime(c.name, c.idleTimeout)) &&
          activationTimeOk &&
          !stoppingContainers.has(c.name)) {
        
        log(`<${c.name}> ${c.idleTimeout || 60}s timeout reached`);
        stoppingContainers.add(c.name);
        await stopContainer(c.name);
        stoppingContainers.delete(c.name);
        logOnce[c.name] = false;
      }
    }
    
    // Group timeout
    for (const g of groups) {
      if (!g.active || !g.idleTimeout || !g.container) continue;

      const groupContainers = Array.isArray(g.container) ? g.container : [g.container];
      const containerChecks = await Promise.all(groupContainers.map(async (name) => {
        const isRunning = containerStatus[name];
        const container = containers.find(c => c.name === name);
        return isRunning && 
              container?.active &&
              now - lastActivity[name] > (g.idleTimeout || 60) * 1000 &&
              (await checkStartTime(name, g.idleTimeout));
      }));

      const shouldStopGroup = containerChecks.every(check => check === true);
      
      if (shouldStopGroup) {
        for (const name of groupContainers) {
          const container = containers.find(c => c.name === name);
          if (containerStatus[name] && container?.active && !stoppingContainers.has(name)) {
            stoppingContainers.add(name);
            await stopContainer(name);
            stoppingContainers.delete(name);
            log(`<${name}> stopped as part of group <${g.name}>`);
          }
        }
      }
    }
  } catch (error) {
    log(`Error in timeout interval: ${error.message}`);
  }
}, 10000);

//----------------------------------------------------------------
// Schedule handling interval
//----------------------------------------------------------------
setInterval(() => {
  const now = new Date();
  const day = now.getDay();
  const time = now.toTimeString().slice(0, 5);

  schedules.forEach(s => {
    const target = s.targetType === "container"
      ? containers.find(c => c.name === s.target)
      : groups.find(g => g.name === s.target);

    if (!target?.active || !s.timers?.length) return;

    s.timers.forEach(timer => {
      if (!timer.active || !timer.days.includes(day)) return;

      if (timer.startTime === time) {
        if (s.targetType === "container") startContainer(s.target);
        else target.container.forEach(n => startContainer(n));
        log(`<${s.target}> scheduled start executed`);
      }

      if (timer.stopTime === time && !stoppingContainers.has(s.target)) {
        stoppingContainers.add(s.target);
        if (s.targetType === "container") stopContainer(s.target);
        else target.container.forEach(n => stopContainer(n));
        stoppingContainers.delete(s.target);
        log(`<${s.target}> scheduled stop executed`);
      }
    });
  });
}, 59000);

//----------------------------------------------------------------
// Configuration reload
//----------------------------------------------------------------
function reloadConfig() {
  try {
    const newConfig = JSON.parse(fs.readFileSync(CONFIG_PATH));
    
    newConfig.containers.forEach(c => {
      if (lastActivity[c.name] === undefined) {
        lastActivity[c.name] = Date.now();
      }
    });

    groups = newConfig.groups;
    containers = newConfig.containers;
    schedules = newConfig.schedules;
    apiKeys = newConfig.apiKeys;
    log("Config reloaded, containers updated");
  } catch (e) {
    log(`Failed to reload config: ${e.message}`);
  }
}

fs.watchFile(CONFIG_PATH, { interval: 500 }, reloadConfig);

//----------------------------------------------------------------
// Web UI Server
//----------------------------------------------------------------
if (UI_PORT) {
  const ui = express();
  ui.use(express.json());
  ui.use("/api/containers", containerRoutes);
  ui.use(express.static("/app/public/ui"));
  ui.use("/api/groups", groupRoutes);
  ui.use("/api/schedules", scheduleRoutes);
  ui.use("/api/apikeys", apiKeyRoutes);

  ui.locals.isContainerRunning = isContainerRunning;
  ui.locals.startContainer = startContainer;
  ui.locals.stopContainer = stopContainer;
  ui.locals.lastActivity = lastActivity;
  ui.locals.allContainers = allContainers;

  ui.listen(UI_PORT, () => {
    log(`WebUI running on port ${UI_PORT}`);
  });
}

//----------------------------------------------------------------
// Start main server
//----------------------------------------------------------------
const server = app.listen(PORT, () => {
  log(`Spinnerr Proxy running on port ${PORT}`);
});

server.on("upgrade", (req, socket, head) => {
  const container = containers.find(c => c.host === req.headers.host);
  if (!container) return socket.destroy();
  
  proxy.ws(req, socket, head, { 
    target: container.url, 
    ws: true, 
    changeOrigin: false, 
    xfwd: true 
  });
});