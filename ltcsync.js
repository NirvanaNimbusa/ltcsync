
const electron=require("electron");
const path = require("path");
const fs = require("fs");
const mf = require("./libSync/media_file");
const pf = require("./libSync/padding_file");
const sessions = require("./libSync/sessions");

/* Housekeeping */
console=electron.remote.getGlobal("console");
document.editing_session = new sessions.EditingSession();

/* User error handling */
function display_error(err) {
  const container=document.getElementById("errors");
  const e=container.appendChild(document.createElement("div"))
  e.innerHTML=err;
  setTimeout(() => container.removeChild(e), 2000);
}


/* Scaling */

function longest_bounds(editing_session) {
  const all_groups = editing_session.non_ltc_files.files.length ?
        editing_session.groups.concat(editing_session.non_ltc_files) :
        editing_session.groups;
  return all_groups.map(
    g => g.bounds().duration).reduce(
      (acc, v) => Math.max(acc, v), 0);
}

// this belongs in libSync
function pretty_time(seconds) {
  const d=new Date(seconds*1000);
  
  return `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}:${d.getUTCSeconds().toString().padStart(2, "0")}.${d.getUTCMilliseconds().toString().padEnd(3, "0")}`;
}
function $pretty_time() {
  console.log(pretty_time(0));
  console.log(pretty_time(59));
  console.log(pretty_time(60));
  console.log(pretty_time(130));
  console.log(pretty_time(3601));
  console.log(pretty_time(3601.5));
}


/* Data rendering */

function file_to_html(file, group_bounds) {
  const e=document.createElement("tr");

  e.appendChild(document.createElement("td"));
  if (file.bounds().start) {
    e.lastChild.innerHTML=pretty_time(file.bounds().start);
  }
  e.appendChild(document.createElement("td")).innerHTML=pretty_time(eval(file.ffprobe.format.duration));

  const fnc=e.appendChild(document.createElement("td"));
  fnc.setAttribute("class", "file");

  const lb=longest_bounds(document.editing_session);

  if(file.bounds().start && group_bounds) {
    // file is in a group of overlapping files
    const padding_s = file.bounds().start-group_bounds.start;
    if (padding_s) {
      // file needs padding relative to group
      const fp=fnc.appendChild(document.createElement("span"));
      fp.setAttribute("class", "padding");
      fp.setAttribute("style", `width: ${padding_s/lb*100}%;`);
      fp.innerHTML = `(${padding_s.toFixed(3)}s)`;
    }
  }

  const width=eval(file.ffprobe.format.duration)/lb;
  const fn=fnc.appendChild(document.createElement("span"));
  fn.setAttribute("class", "name");
  fn.innerHTML = path.basename(file.ffprobe.format.filename);
  fn.setAttribute("style", `width: ${width*100}%;`);
  
  return e;
}

function file_group_to_html(group) {
  const e=document.createElement("tbody");

  const h=e.appendChild(document.createElement("tr"));
  h.setAttribute("class", "group-header");
  h.appendChild(document.createElement("td")).innerHTML=pretty_time(group.bounds().start);
  h.appendChild(document.createElement("td")).innerHTML=pretty_time(group.bounds().duration);
  h.appendChild(document.createElement("th")).innerHTML=`Group of ${group.files.length} overlapping files`;
  const sorted_files=group.files.slice().sort((f0, f1) => f0.compare(f1));
  sorted_files.forEach(f => e.appendChild(file_to_html(f, group.bounds())));

  return e;
}
function nonoverlapping_groups_to_html(groups) {
  const e=document.createElement("tbody");

  const h=e.appendChild(document.createElement("tr"));
  h.setAttribute("class", "group-header");
  h.appendChild(document.createElement("td"));
  h.appendChild(document.createElement("td"));
  h.appendChild(document.createElement("th")).innerHTML=`Non-overlapping files with embedded timecode: ${groups.length}`;
  const sorted_groups=groups.slice().sort((g0, g1) => g0.compare(g1));
  sorted_groups.forEach(g => g.files.forEach(f => e.appendChild(file_to_html(f, null))));

  return e;
}
function nonltc_file_group_to_html(group) {
  const e=document.createElement("tbody");

  const h=e.appendChild(document.createElement("tr"));
  h.setAttribute("class", "group-header");
  h.appendChild(document.createElement("th"));
  h.appendChild(document.createElement("th")).innerHTML="Duration";
  h.appendChild(document.createElement("th")).innerHTML=`Files without embedded timecode: ${group.files.length}`;
  const sorted_files=group.files.slice().sort((f0, f1) => f0.compare(f1));
  sorted_files.forEach(f => e.appendChild(file_to_html(f, group.bounds())));

  return e;
}

function editing_session_to_html(session) {
  const e=document.createElement("table");

  const h=e.appendChild(document.createElement("thead")).appendChild(document.createElement("tr"));
  h.appendChild(document.createElement("th")).innerHTML="Start TC";
  h.appendChild(document.createElement("th")).innerHTML="Duration";
  h.appendChild(document.createElement("th")).innerHTML="File notes";
  
  session.groups.filter(g => g.files.length>1).sort((g0, g1) => g0.compare(g1)).forEach(g => {
    e.appendChild(file_group_to_html(g));
    e.appendChild(document.createElement("tbody")).appendChild(document.createElement("tr")).appendChild(document.createElement("td"));
    e.lastChild.setAttribute("class", "dummy-spacer");
  });

  const nonoverlapping_groups=session.groups.filter(g => g.files.length==1).sort((g0, g1) => g0.compare(g1));
  if (nonoverlapping_groups.length) {
    e.appendChild(nonoverlapping_groups_to_html(nonoverlapping_groups));
    e.appendChild(document.createElement("tbody")).appendChild(document.createElement("tr")).appendChild(document.createElement("td"));
    e.lastChild.setAttribute("class", "dummy-spacer");
  };

  if (session.non_ltc_files.files.length) {
    e.appendChild(nonltc_file_group_to_html(session.non_ltc_files));
  }
  return e;
}


/* Adding files: either from menu (through RPC) or through
 * drag-and-drop. */

function addFiles(fpaths) {
  fpaths.forEach(fpath => fs.stat(fpath, (err, stat) => {
    if (err) {
      display_error(err.message);
    } else if (stat.isDirectory()) {
      fs.readdir(fpath, (err, files) => {
        if (err) {
          display_error(err.message);
        } else {
          addFiles(files.map(f => path.resolve(fpath, f)));
        }
      });
    } else if (path.basename(fpath).includes(pf.PAD_SUFFIX)) {
      // ignore generated files
    } else {
      mf.probe_file(fpath, (err, mediafile) => {
        if (err) {
          display_error(`${err.message} (${fpath})`);
        } else if (document.editing_session.add_file(mediafile, err => display_error(err.message))) {
          const fd=document.getElementById("filedisplay");
          while (fd.firstChild) {
            fd.removeChild(fd.lastChild);
          }
          fd.appendChild(editing_session_to_html(document.editing_session));
        }
      });
    }
  }));
}

/* Generating Output */
function generate_padding_files(session) {
  session.groups.filter(g => g.files.length>1).forEach(g => {
    g.files.forEach(f => {
      const offset = f.bounds().start - g.bounds().start;
      if (offset) {
        pf.write_padding_file(f, offset, (e, p) => {
          if (e) {
            display_error(e);
          } else {
            display_error(`wrote ${p}`);
          }
        });
      }
    });
  });
}


/* User Input */
electron.ipcRenderer.on("addFiles", function(event, paths) {
  addFiles(paths);
});

document.addEventListener("drop", function (e) {
  e.preventDefault();
  e.stopPropagation();
  addFiles(Array.from(e.dataTransfer.files, p => p.path));
});

document.addEventListener("dragover", function (e) {
  e.preventDefault();
  e.stopPropagation();
});

electron.ipcRenderer.on("generate_padding_files", function(event) {
  generate_padding_files(document.editing_session);
});
