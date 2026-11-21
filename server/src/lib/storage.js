import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getEnv } from "../config/env.js";
import { AppError } from "../utils/AppError.js";

const KEY_SEGMENT_REGEX = /^[A-Za-z0-9._-]+$/;

export class LocalStorageAdapter {
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir);
  }

  _resolveKey(key) {
    if (typeof key !== "string" || !key) {
      throw new AppError(500, "Invalid storage key", {
        details: "Key must be a non-empty string",
      });
    }
    const segments = key.split("/");
    for (const seg of segments) {
      if (!KEY_SEGMENT_REGEX.test(seg) || seg === "." || seg === "..") {
        throw new AppError(500, "Invalid storage key", {
          details: `Invalid segment: ${seg}`,
        });
      }
    }
    const resolved = path.resolve(this.rootDir, ...segments);
    if (
      !resolved.startsWith(this.rootDir + path.sep) &&
      resolved !== this.rootDir
    ) {
      throw new AppError(500, "Invalid storage key", {
        details: "Key resolves outside storage directory",
      });
    }
    return resolved;
  }

  async putStream(key, stream) {
    const targetPath = this._resolveKey(key);
    const targetDir = path.dirname(targetPath);
    await fs.promises.mkdir(targetDir, { recursive: true });

    const tempPath = path.join(targetDir, `.tmp-${crypto.randomUUID()}`);
    const hash = crypto.createHash("sha256");
    let bytes = 0;

    const outStream = fs.createWriteStream(tempPath);

    await new Promise((resolve, reject) => {
      stream.on("data", (chunk) => {
        bytes += chunk.length;
        hash.update(chunk);
      });
      stream.on("error", reject);
      outStream.on("error", reject);
      outStream.on("finish", resolve);
      stream.pipe(outStream);
    });

    await fs.promises.rename(tempPath, targetPath);
    const sha256 = hash.digest("hex");
    return { key, bytes, sha256 };
  }

  async putBuffer(key, data) {
    const targetPath = this._resolveKey(key);
    const targetDir = path.dirname(targetPath);
    await fs.promises.mkdir(targetDir, { recursive: true });

    const tempPath = path.join(targetDir, `.tmp-${crypto.randomUUID()}`);
    await fs.promises.writeFile(tempPath, data);
    await fs.promises.rename(tempPath, targetPath);

    const sha256 = crypto.createHash("sha256").update(data).digest("hex");
    return { key, bytes: data.length, sha256 };
  }

  getStream(key) {
    const targetPath = this._resolveKey(key);
    return fs.createReadStream(targetPath);
  }

  async readBuffer(key) {
    const targetPath = this._resolveKey(key);
    return await fs.promises.readFile(targetPath);
  }

  async exists(key) {
    try {
      const targetPath = this._resolveKey(key);
      await fs.promises.access(targetPath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async delete(key) {
    try {
      const targetPath = this._resolveKey(key);
      await fs.promises.unlink(targetPath);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }

  async deletePrefix(prefix) {
    const targetPath = this._resolveKey(prefix);
    try {
      await fs.promises.rm(targetPath, { recursive: true, force: true });
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
}

let storageSingleton = null;
export function getStorage() {
  if (!storageSingleton) {
    const env = getEnv();
    storageSingleton = new LocalStorageAdapter(env.STORAGE_DIR);
  }
  return storageSingleton;
}
