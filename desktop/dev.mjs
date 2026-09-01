import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import process from "node:process";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const frontend = spawn(command, ["--dir", "../frontend", "dev", "--host", "127.0.0.1"], {
  stdio: "inherit",
  windowsHide: true,
});

function isListening(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

let ready = false;
for (let attempt = 0; attempt < 80; attempt += 1) {
  if (await isListening(5173)) {
    ready = true;
    break;
  }
  await delay(250);
}
if (!ready) {
  frontend.kill();
  throw new Error("Vite did not start on http://127.0.0.1:5173");
}

const electron = spawn(command, ["exec", "electron", "."], {
  stdio: "inherit",
  windowsHide: false,
  env: { ...process.env, SHOPEERS_DESKTOP_DEV_URL: "http://127.0.0.1:5173" },
});

function stop() {
  if (!frontend.killed) frontend.kill();
  if (!electron.killed) electron.kill();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
electron.on("exit", (code) => {
  stop();
  process.exit(code ?? 0);
});
