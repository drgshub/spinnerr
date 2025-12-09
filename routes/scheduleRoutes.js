import express from "express";
import { readConfig, saveConfig } from "./helpers.js";

const router = express.Router();

function generateId() {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

// GET all schedules ---------------------
router.get("/", (req, res) => {
  const config = readConfig();
  res.json(config.schedules || []);
});

// CREATE schedule -----------------------
router.post("/", (req, res) => {
  const config = readConfig();
  
  const newSchedule = {
    ...req.body,
    id: generateId()
  };

  config.schedules.push(newSchedule);
  saveConfig(config);

  res.json(newSchedule);
});

// UPDATE schedule -----------------------
router.put("/:id", (req, res) => {
  const id = req.params.id;
  const config = readConfig();

  const index = config.schedules.findIndex(s => s.id == id);
  if (index === -1) return res.status(404).json({ error: "Not found" });

  config.schedules[index] = { ...config.schedules[index], ...req.body };
  saveConfig(config);

  res.json(config.schedules[index]);
});

// DELETE schedule -----------------------
router.delete("/:id", (req, res) => {
  const id = req.params.id;
  const config = readConfig();

  config.schedules = config.schedules.filter(s => s.id != id);
  saveConfig(config);

  res.json({ success: true });
});

export default router;