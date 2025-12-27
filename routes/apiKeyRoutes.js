import express from "express";
import { readConfig, saveConfig } from "./helpers.js";

const router = express.Router();

// Routes --------------------------------

// GET API keys config
router.get("/", (req, res) => {
  const { apiKeys } = readConfig();
  res.json(apiKeys || {});
});

// UPDATE API keys config
router.put("/", (req, res) => {
  const updates = { ...req.body };
  const config = readConfig();

  config.apiKeys = {
    ...config.apiKeys,
    ...updates
  };

  saveConfig(config);
  res.json(config.apiKeys);
});

export default router;