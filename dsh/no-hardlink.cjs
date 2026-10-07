// Android/Termux: SELinux zabranjuje hard link u privatnom app-data direktorijumu,
// pa svaki link() puca sa EACCES. dsh ga koristi za atomican no-replace publish
// (write tmp -> link -> rm tmp) na vise mesta: session persistence, attachment
// store i `write` alat (dsh-fs-local).
//
// copyFile sa COPYFILE_EXCL daje isti krajnji rezultat i istu EEXIST semantiku
// (bitno za sha256 dedup i za "concurrent creator wins" u write alatu).
const fs = require("node:fs");
const { COPYFILE_EXCL } = fs.constants;

fs.promises.link = (source, destination) =>
  fs.promises.copyFile(source, destination, COPYFILE_EXCL);
fs.linkSync = (source, destination) =>
  fs.copyFileSync(source, destination, COPYFILE_EXCL);
fs.link = (source, destination, callback) =>
  fs.copyFile(source, destination, COPYFILE_EXCL, callback);
