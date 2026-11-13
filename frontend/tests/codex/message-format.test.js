import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {readFile} from 'node:fs/promises'
import {transformWithEsbuild} from 'vite'
const source=await readFile(new URL('../../src/components/SafeMessage.jsx',import.meta.url),'utf8')
const compiled=await transformWithEsbuild(source.replace("from 'react'",`from '${import.meta.resolve('react')}'`),'SafeMessage.jsx',{loader:'jsx',jsx:'transform'})
const {default:SafeMessage}=await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`)
const render=text=>renderToStaticMarkup(React.createElement(SafeMessage,{text}))
test('Markdown emphasis, heading and star bullets display without syntax',()=>{
 const html=render('## 今日建议\n\n**重点**，*先开始*，__再完善__，~~删除项~~\n\n* 第一步\n* 第二步')
 assert.ok(!html.includes('##'));assert.ok(!html.includes('*'));assert.ok(!html.includes('__'));assert.ok(!html.includes('~~'))
 assert.match(html,/<li>第一步<\/li>/);assert.ok(html.includes('重点'))
})
test('code fences are hidden while code and arithmetic remain intact',()=>{
 const html=render('```python\nx = 2 * 3\n```\n\n3 * 4 = 12，变量 my_name')
 assert.ok(!html.includes('```'));assert.ok(html.includes('x = 2 * 3'));assert.ok(html.includes('3 * 4 = 12'));assert.ok(html.includes('my_name'))
})
test('HTML stays inert and inline code loses its formatting delimiters',()=>{
 const html=render('使用 `print()`\n<script>alert(1)</script>')
 assert.ok(!html.includes('`'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'))
})
