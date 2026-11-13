import test from 'node:test'
import assert from 'node:assert/strict'
import { restoreProfileLocation, activeGoals } from '../../src/codex/profile.js'
test('legacy sections preserve their management destination',()=>{
 assert.deepEqual(restoreProfileLocation({section:'time'}),{section:'more',group:'time'})
 assert.deepEqual(restoreProfileLocation({section:'data'}),{section:'more',group:'data'})
 assert.equal(restoreProfileLocation({section:'invalid'}).section,'goals')
 assert.deepEqual(restoreProfileLocation({section:'more',group:'categories'}),{section:'more',group:'categories'})
})
test('active goals sort by priority without changing stored order',()=>{
 const rows=[{id:1,status:'active',priority:3},{id:2,status:'paused',priority:1},{id:3,status:'active',priority:1}]
 assert.deepEqual(activeGoals(rows).map(x=>x.id),[3,1]);assert.equal(rows[0].id,1)
})
