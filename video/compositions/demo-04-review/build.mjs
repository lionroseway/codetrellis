// Builds this talk demo's index.html from beats.mjs (talk/build.mjs).
import path from 'node:path';
import { build } from '../../talk/build.mjs';
import demo from './beats.mjs';

build(path.dirname(new URL(import.meta.url).pathname), demo);
