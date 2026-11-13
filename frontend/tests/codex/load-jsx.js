import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

// Exercise the actual JSX and its relative dependencies, not stub components.
export async function loadJsx(url) {
  const entry = fileURLToPath(url)
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node',
    jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'node-external-dependencies', setup(builder) {
      builder.onResolve({ filter: /^[^./]|^node:/ }, args => {
        if (args.kind === 'entry-point' || args.path.startsWith('/') || /^[A-Za-z]:/.test(args.path)) return
        return { path: import.meta.resolve(args.path), external: true }
      })
    } }]
  })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}
