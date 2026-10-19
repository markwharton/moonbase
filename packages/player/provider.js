// The provider: where a visit keeps a person's files and settings, chosen once, and every page's disks and settings
// from it. A site makes one a page from a module of its own, choosing the backend (this browser's; an account's, the
// site's API's, when signed in) and giving a visit's values and its policy; a page with no site (moonbase-play's) makes
// this one with nothing given. The player and the programs never choose: a page passes the title's disk and the
// settings to play() (play.js), and a program that saves opens its disks here. Nothing here knows of an address.
//
//   const { disk, settings } = await provider({ backend, visit, fixed, hidden })
//     backend    where files are kept (disk/disk.js says what one is); none given, this browser's, IndexedDB
//                (disk/local.js), or where the browser keeps nothing (a private window may not) memory, for this
//                visit only, and the disks say so (`kept`)
//     visit      def => a setting's value for this visit, the site's to give (settings.js); fixed and hidden, the
//                page's policy of the settings
//   await disk(name)    a disk by its name, on the backend: titleDisk(slug), programDisk(name) (disk/disk.js)
//   settings            the person's settings, the typed store (settings.js), on the disk settingsDisk('person')
import { openDisk } from './disk/disk.js';
import { local } from './disk/local.js';
import { memory } from './disk/memory.js';
import { settingsStore } from './settings.js';

export async function provider({ backend, visit, fixed = {}, hidden = [] } = {}) {
  if (!backend) { try { backend = await local(); } catch { backend = memory({ kept: false }); } }
  const disk = name => openDisk(name, { backend });
  const settings = settingsStore({ disks: { person: await disk(settingsDisk('person')) }, visit, fixed, hidden });
  return { disk, settings };
}

export const settingsDisk = owner => `settings/${owner}`;
