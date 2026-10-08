import typescript from '@rollup/plugin-typescript';
import packageJson from './package.json' with { type: "json" };
import resolve from '@rollup/plugin-node-resolve';
import json from '@rollup/plugin-json';
import commonjs from '@rollup/plugin-commonjs';
// {preferBuiltins:true, jsnext: true}
const config = [
  {
    input: 'src/app-fp.ts',
    output: {
      dir: 'dist',
      entryFileNames: '[name].js',
      format: 'esm',
      sourcemap: true

    },
    external: packageJson.dependencies ? Object.keys(packageJson.dependencies) : [],
    plugins: [
      typescript(),
      json(),
      resolve({preferBuiltins:true}),
      commonjs({include: ['src/app.ts', 'node_modules/**']}),
    ]
  }
];

export default config;
