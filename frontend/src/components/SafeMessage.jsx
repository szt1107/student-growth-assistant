import React from 'react'

function inline(text, keyPrefix) {
  return text.split(/(`[^`]+`|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*(?=\S)[^*]*\S\*)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={`${keyPrefix}-${index}`}>{part.slice(1,-1)}</code>
    if (part.startsWith('***') && part.endsWith('***')) return <strong key={`${keyPrefix}-${index}`}>{part.slice(3,-3)}</strong>
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) return <strong key={`${keyPrefix}-${index}`}>{part.slice(2,-2)}</strong>
    if (part.startsWith('~~') && part.endsWith('~~')) return <React.Fragment key={`${keyPrefix}-${index}`}>{part.slice(2,-2)}</React.Fragment>
    if (part.startsWith('*') && part.endsWith('*') && part.length>2) return <React.Fragment key={`${keyPrefix}-${index}`}>{part.slice(1,-1)}</React.Fragment>
    return <React.Fragment key={`${keyPrefix}-${index}`}>{part}</React.Fragment>
  })
}

/** Render limited Markdown as safe text elements. Never interprets HTML or links. */
export default function SafeMessage({ text = '' }) {
  const blocks = []
  let paragraph = []
  let list = []
  let listKind = ''
  let fence = null, code = []
  const flushCode = () => { blocks.push(<pre key={`code-${blocks.length}`}><code>{code.join('\n')}</code></pre>); code=[] }

  const flushParagraph = () => {
    if (paragraph.length) blocks.push(<p key={`p-${blocks.length}`}>{paragraph.map((line, i) => <React.Fragment key={i}>{i > 0 && <br />}{inline(line, `p-${i}`)}</React.Fragment>)}</p>)
    paragraph = []
  }
  const flushList = () => {
    if (!list.length) return
    const Tag = listKind === 'ordered' ? 'ol' : 'ul'
    blocks.push(<Tag key={`l-${blocks.length}`}>{list.map((line, i) => <li key={i}>{inline(line, `l-${i}`)}</li>)}</Tag>)
    list = []; listKind = ''
  }

  for (const raw of String(text).split(/\r?\n/)) {
    const marker=raw.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/)
    if(fence){
      if(marker&&marker[1][0]===fence[0]&&marker[1].length>=fence.length&&!marker[2].trim()){flushCode();fence=null}
      else code.push(raw)
      continue
    }
    if(marker){flushParagraph();flushList();fence=marker[1];continue}
    const line=raw.replace(/^\s{0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/,'$1').replace(/^\s{0,3}>\s?/, '')
    if(/^\s*(?:\*\s*){3,}$/.test(line)||/^\s*(?:-\s*){3,}$/.test(line)){flushParagraph();flushList();continue}
    const unordered = line.match(/^\s*[-•*+]\s+(.*)$/)
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (unordered || ordered) {
      flushParagraph()
      const kind = ordered ? 'ordered' : 'unordered'
      if (listKind && listKind !== kind) flushList()
      listKind = kind
      list.push((unordered || ordered)[1])
    } else {
      flushList()
      if (!line.trim()) flushParagraph()
      else paragraph.push(line)
    }
  }
  if(fence)flushCode()
  flushList(); flushParagraph()
  return <div className="safe-message">{blocks}</div>
}
