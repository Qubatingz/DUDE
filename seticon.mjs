import fs from 'fs';
import * as ResEdit from 'resedit';  // npm i resedit
const [exePath, icoPath] = process.argv.slice(2);
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
  v.setFileVersion(1, 0, 0, 0); v.setProductVersion(1, 0, 0, 0);
  v.outputToResourceEntries(res.entries);
}
res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log('icon + version info set, groups:', groups.length);
