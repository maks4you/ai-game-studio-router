import { spawn } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { ensureInsideRoot } from "./files.js";

export async function extractFrames(
  inputMp4: string,
  outputDir: string,
): Promise<string[]> {
  ensureInsideRoot(inputMp4);
  ensureInsideRoot(outputDir);
  if (!existsSync(inputMp4)) {
    throw new Error("input video not found");
  }

  if (existsSync(outputDir)) {
    const existing = await readdir(outputDir);
    for (const f of existing) {
      if (f.endsWith(".png")) await rm(path.join(outputDir, f));
    }
  } else {
    await mkdir(outputDir, { recursive: true });
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-hide_banner", "-y", "-i", inputMp4,
      "-vf", "chromakey=0x00b140:0.15:0.08,scale=320:-1,format=rgba",
      "-start_number", "1", path.join(outputDir, "frame-%05d.png"),
    ], {
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg frame extraction exited with code ${code}`));
    });
  });

  const entries = await readdir(outputDir);
  const frames = entries.filter((f) => f.endsWith(".png")).sort();
  if (frames.length === 0) {
    throw new Error("no frames produced");
  }
  return frames;
}
