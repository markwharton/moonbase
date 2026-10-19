// @moonbase-machines/player: every module by name, for one bundled file or to take the whole package at once:
// import { play } from '@moonbase-machines/player', its modules each a namespace named by its path (play, diskDisk,
// enginesOriginal). Each module can be imported on its own too: '@moonbase-machines/player/<module>.js' (play.js,
// disk/disk.js).
export * as play from './play.js';
export * as keys from './keys.js';
export * as saves from './saves.js';
export * as enginesOriginal from './engines/original.js';
export * as enginesScenes from './engines/scenes.js';
export * as audio from './audio.js';
export * as modal from './modal.js';
export * as parts from './parts.js';
export * as diskDialogs from './disk/dialogs.js';
export * as diskDisk from './disk/disk.js';
export * as diskLocal from './disk/local.js';
export * as diskMemory from './disk/memory.js';
export * as remakeC64View from './remake/c64-view.js';
export * as remakeCardView from './remake/card-view.js';
export * as remakeCard from './remake/card.js';
export * as remakeCards from './remake/cards.js';
export * as remakeCompile from './remake/compile.js';
export * as remakeEngine from './remake/engine.js';
export * as remakeEvents from './remake/events.js';
export * as remakeLayout from './remake/layout.js';
export * as remakeLift from './remake/lift.js';
export * as remakeLoad from './remake/load.js';
export * as remakeProblems from './remake/problems.js';
export * as remakeRaster from './remake/raster.js';
export * as remakeScript from './remake/script.js';
export * as remakeVector from './remake/vector.js';
export * as remakeView from './remake/view.js';
