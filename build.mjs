// The release build: minify, then obfuscate, the game; minify the page;
// copy the box art the page uses. GitHub Actions runs this on a tag.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { minify } from 'html-minifier-terser';

mkdirSync('dist/cover-art', { recursive: true });

// Minify first: short names, no comments, dead code gone.
const small = transformSync(readFileSync('game.js', 'utf8'), { minify: true, target: 'es2020' }).code;

// Then obfuscate, moderately. No control-flow flattening: it would slow
// the physics, which runs 120 times a second.
const hidden = JavaScriptObfuscator.obfuscate(small, {
  compact: true,
  identifierNamesGenerator: 'mangled',
  stringArray: true,
  stringArrayThreshold: 0.75,
  splitStrings: true,
  splitStringsChunkLength: 8,
  transformObjectKeys: true,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.1,
  controlFlowFlattening: false,
}).getObfuscatedCode();
writeFileSync('dist/game.js', hidden);

writeFileSync('dist/index.html', await minify(readFileSync('index.html', 'utf8'), {
  collapseWhitespace: true,
  removeComments: true,
  minifyCSS: true,
  minifyJS: true,
}));

for (const f of ['front.webp', 'back.webp']) copyFileSync(`cover-art/${f}`, `dist/cover-art/${f}`);
