import test from 'node:test'
import assert from 'node:assert/strict'
import { ensureConversationRuntime } from '../../src/api.js'

test('chat accepts supported runtime upgrades while rejecting unknown or unavailable backends',async()=>{
  const original=globalThis.fetch
  try {
    for(const protocol of ['draft-recovery-v3','chat-capabilities-v4']){
      globalThis.fetch=async()=>new Response(JSON.stringify({runtime:{protocol,skills_available:true}}))
      assert.equal((await ensureConversationRuntime()).protocol,protocol)
    }
    for(const runtime of [{protocol:'unknown',skills_available:true},{protocol:'chat-capabilities-v4',skills_available:false}]){
      globalThis.fetch=async()=>new Response(JSON.stringify({runtime}))
      await assert.rejects(ensureConversationRuntime())
    }
  }finally{globalThis.fetch=original}
})
