/* Runs before each page in the window, in a sandbox, apart from the page.

   The app's own pages (the connect screen) get three functions and nothing
   else. A page from the server gets none: it is a web page and is treated
   like one. The main process checks who is calling as well, so this is the
   second lock, not the only one. */

import { contextBridge, ipcRenderer, webFrame } from "electron";

if (location.protocol === "file:") {
  contextBridge.exposeInMainWorld("huddleDesktop", {
    state: () => ipcRenderer.invoke("huddle:state"),
    connect: (address: string) => ipcRenderer.invoke("huddle:connect", address),
    retry: () => ipcRenderer.invoke("huddle:retry"),
  });
} else {
  /* The desktop app raises system notifications itself, from the tray,
     whether or not a page is open. Without the browser's Notification API
     the web app hides its own "Desktop alerts" switch (it reads this as
     "unsupported"), so there is one place that alerts and no second switch
     that appears to do nothing. Its sound switch still works. */
  void webFrame.executeJavaScript("try { delete window.Notification } catch {}");
}
