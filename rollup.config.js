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
    // Any warning fails the build, except two known ones from bundled dependencies:
    // @ory/hydra-client-fetch's TypeScript helpers use top-level `this`, and pg and pg-pool import each other
    onwarn(warning) {
      const fromDependency = [warning.id, ...(warning.ids ?? [])].some((id) => id?.includes('/node_modules/'))
      if (fromDependency && ['THIS_IS_UNDEFINED', 'CIRCULAR_DEPENDENCY'].includes(warning.code)) {
        return
      }
      throw new Error(`Rollup warning treated as error: ${warning.message}`)
    },
    plugins: [
      typescript({ noEmitOnError: true }),
      json(),
      resolve({preferBuiltins:true}),
      commonjs({include: ['src/app.ts', 'node_modules/**']}),
    ]
  }
];

export default config;
