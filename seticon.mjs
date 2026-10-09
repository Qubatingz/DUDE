import fs from 'fs';
import * as ResEdit from 'resedit';  // npm i resedit
const [exePath, icoPath] = process.argv.slice(2);
const ver = (JSON.parse(fs.readFileSync(new URL('./app/package.json', import.meta.url))).version || '1.0.0').split('.').map(Number);
const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exe);
const ico = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const gid = groups.length ? groups[0].id : 1, lang = groups.length ? groups[0].lang : 1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, gid, lang, ico.icons.map(i => i.data));
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
for (const v of vi) {
  const langs = v.getAllLanguagesForStringValues();
  for (const l of langs) v.setStringValues(l, { ProductName: 'Dude', FileDescription: 'Dude - desktop pet', CompanyName: 'Kirenga Jimmy', OriginalFilename: 'Dude.exe', InternalName: 'Dude', LegalCopyright: 'Kirenga Jimmy' });
  v.setFileVersion(ver[0], ver[1], ver[2], 0); v.setProductVersion(ver[0], ver[1], ver[2], 0);
  v.outputToResourceEntries(res.entries);
}
res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log('icon + version info set, groups:', groups.length);
