import { spawn } from "node:child_process";

const children = [
  spawn("npm", ["run", "dev:client"], { stdio: "inherit", shell: process.platform === "win32" }),
  spawn("npm", ["run", "dev:server"], { stdio: "inherit", shell: process.platform === "win32" }),
];

let shuttingDown = false;
function stopAll(signal: NodeJS.Signals = "SIGTERM", exitCode = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
  process.exitCode = exitCode;
}

process.on("SIGINT", () => stopAll("SIGINT", 0));
process.on("SIGTERM", () => stopAll("SIGTERM", 0));

for (const child of children) {
  child.on("exit", (code) => {
    stopAll("SIGTERM", code ?? 0);
  });
}
