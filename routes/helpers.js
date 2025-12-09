import fs from "fs";
import path from "path";

const configPath = path.join("/app/config", "config.json");

// Helpers -------------------------------
function readConfig() {
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return { 
      containers: parsed.containers || [],
      order: parsed.order || (parsed.containers ? parsed.containers.map(c => c.name) : []),
      groups: parsed.groups || [],
      groupOrder: parsed.groupOrder || (parsed.groups ? parsed.groups.map(g => g.name) : []),
      schedules: parsed.schedules || []
    };
  } catch (err) {
    console.error("Failed to read config:", err);
    return { containers: [], order: [], groups: [], groupOrder: [], schedules: []};
  }
}

// saveConfig
function saveConfig(config) {
  const toSave = {
    containers: config.containers || [],
    order: config.order || (config.containers ? config.containers.map(c => c.name) : []),
    groups: config.groups || [],
    groupOrder: config.groupOrder || (config.groups ? config.groups.map(g => g.name) : []),
    schedules: config.schedules || []
  };

  fs.writeFileSync(configPath, JSON.stringify(toSave, null, 2));
}

export { readConfig, saveConfig };