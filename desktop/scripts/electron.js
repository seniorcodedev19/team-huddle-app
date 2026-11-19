/* Starts Electron as Electron.

   A terminal inside an Electron-based editor (VS Code and its relatives) can
   hand down ELECTRON_RUN_AS_NODE=1, which makes the Electron binary behave
   as plain Node: `require("electron").app` is then undefined and the app
   dies on its first line. Removing the variable here makes `npm start` work
   wherever it is typed. */

const { spawn } = require("node:child_process");
const electron = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, process.argv.slice(2), { stdio: "inherit", env });
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
