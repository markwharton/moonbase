// How a C64 game starts, in a page and in tests that start every game as the page does: which
// ROMs it runs on, a player page's ?roms=<choice> (/play/<slug>/original/, in the preview),
//   (none), moonbase    moonbase's, characters and all (rom.js): the default, as moonbase.au
//                       has it
//   commodore           Commodore's, where this machine has them: a flag, off unless asked for,
//                       kept as everyone else keeps them, to compare
//   moonbase-petscii    moonbase's, with Commodore's character ROM, where this machine has it
//
//   await c64Roms(choice, slug, load)   the roms for new C64(game, roms), or null where Commodore's
//                                       are asked for and cannot be had; load(name) gives a ROM's
//                                       bytes (<name>.bin), or throws where it is not there
//   typed(m, game)                      what is typed once BASIC is ready: LOAD"<start>",8,1,
//                                       and RUN for a BASIC program, one loaded at $0801 (ZOOPAK
//                                       loads over the stack and starts itself, and a RUN typed
//                                       after it would reach its menu as a stray RETURN)
import { standIn } from './rom.js';

export const ROM_CHOICES = [null, 'commodore', 'moonbase-petscii'];

export async function c64Roms(choice, slug, load) {
  if (choice !== 'commodore' && choice !== 'moonbase-petscii') return standIn();
  try {
    if (choice === 'moonbase-petscii') return { ...standIn(), chargen: await load('chargen') };
    return { kernal: await load('kernal'), basic: await load('basic'), chargen: await load('chargen') };
  } catch {
    return null;
  }
}

export function typed(m, game) {
  const raw = m.drive.find(Uint8Array.from(game.start, c => c.charCodeAt(0)))?.raw;
  return 'LOAD"' + game.start + '",8,1\r' + (raw && (raw[0] | raw[1] << 8) === 0x801 ? 'RUN\r' : '');
}
