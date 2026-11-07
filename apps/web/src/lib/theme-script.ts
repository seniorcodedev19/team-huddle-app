export const themeScript = `(function(){try{var t=localStorage.getItem("theme");var dark=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",dark?"dark":"light");}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;

/* The sidebar's collapsed state, applied before paint for the same reason as
   the theme: read in an effect instead and a collapsed sidebar renders open
   on every load, then snaps shut. */
export const navScript = `(function(){try{if(localStorage.getItem("nav")==="off"){document.documentElement.setAttribute("data-nav","off");}}catch(e){}})();`;
