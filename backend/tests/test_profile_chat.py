"""Home-chat profile drafts, using isolated databases and mocked providers."""
import asyncio
import json
from copy import deepcopy

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.services import ai_skills, conversation_tools, workspace_drafts, claude_client
from app.services.conversation_tools import plan as real_plan
from app.workspace_schemas import ToolPlan
from tests.test_ai_skills import call, send
from tests.test_draft_defaults import defaults_chat, ref_of
from tests.codex.test_chat_capabilities import draft, confirm


@pytest.mark.parametrize('text',[
    '帮我把这个偏好写入档案','把刚才的健身习惯存入档案',
    '请记到我的档案里','把这个偏好保存到档案','帮我记录这个偏好',
    '先不要保存，帮我生成档案草案','不要写入档案，先给我档案草案',
])
def test_profile_write_intent(text):
    selected=ai_skills.select_skills(text)
    assert selected.expected=='profile' and 'profile_draft' in selected.allowed
    assert 'planning_draft' not in selected.allowed


def profile_history():
    return [
        {'role':'user','text':'上午11点健身合适'},
        {'role':'assistant','text':'每天还是工作日？多久，例如30分钟？'},
        {'role':'user','text':'帮我把这个偏好写入档案'},
        {'role':'assistant','text':'请补充适用星期和时长','business_status':'needs_input'},
        {'role':'user','text':'嗯嗯'},
        {'role':'assistant','text':'可以告诉我星期和时长','business_status':'chat'},
    ]


@pytest.mark.parametrize('text',['工作日，1h','周末，30min','每天，一个半小时','周一到周五，1小时'])
def test_profile_details_inherit_explicit_request(text):
    selected=ai_skills.select_skills(text,profile_history())
    assert selected.expected=='profile' and selected.reason=='user_followup'


@pytest.mark.parametrize('text',[
    '先不要把这个偏好写入档案','如果把这个偏好存入档案会怎样',
    '只想了解档案是什么','他说“把这个偏好写入档案”是什么意思','嗯嗯',
    '先不要保存这个偏好到档案','怎么把偏好写入档案',
])
def test_profile_discussion_does_not_grant_write(text):
    assert ai_skills.select_skills(text,profile_history()).expected is None


@pytest.mark.parametrize('tail',[
    [{'role':'user','text':'换个话题，解释动态规划'}],
    [{'role':'user','text':'先不要把偏好写入档案'}],
    [{'role':'assistant','text':'草案已生成','business_status':'awaiting_confirmation'}],
])
def test_details_cannot_revive_cancelled_or_completed_profile(tail):
    assert ai_skills.select_skills('工作日，1h',profile_history()+tail).expected is None
    assert ai_skills.select_skills('工作日，1h',[{'role':'assistant','text':'我可以帮你生成档案草案'}]).expected is None


def test_real_planner_receives_profile_category_contract(monkeypatch):
    captured=[]
    async def provider(text,system,*args,**kwargs):
        captured.append((json.loads(text),system))
        return json.dumps({'calls':[{'name':'profile_draft','arguments':{'operations':operations()}}]})
    monkeypatch.setattr(claude_client,'request_claude',provider)
    monkeypatch.setattr(claude_client,'get_claude_config',lambda:None)
    result=asyncio.run(real_plan({'message':'工作日，1h','history':profile_history(),'context':{}}))
    packet,system=captured[0]
    assert result.calls[0].name=='profile_draft'
    assert 'create_category' in packet['business_operations']
    assert 'category_ref' in packet['business_operations']['create_preference_rule']['fields']
    assert '11:00–12:00' in system and '不要求用户重复说' in system


def operations():
    return [{'op':'create_category','name':'健身','temp_ref':'draftcat:fitness'},
        {'op':'create_preference_rule','name':'健身时间偏好','kind':'prefer_time',
        'category_ref':'draftcat:fitness','weekdays':[1,2,3,4,5],
        'parameters':{'start':'11:00','end':'12:00'}}]


def test_multiturn_profile_recovery_waits_for_confirmation(client,defaults_chat):
    sid=defaults_chat
    before=call(client,'/api/assistant/preference-rules')['rules']
    for index,text in enumerate(['上午11点健身合适','帮我把这个偏好写入档案','嗯嗯']):
        result=send(client,sid,text,str(index))
        assert not any(r.get('draft') for r in result['content']['tools'])
    result=send(client,sid,'工作日，1h','details')
    value=ref_of(result)
    assert value['kind']=='profile' and value['status']=='ready'
    proposed=value['content']['operations']
    assert proposed[0]['name']=='健身' and proposed[1]['weekdays']==[1,2,3,4,5]
    assert proposed[1]['parameters']=={'start':'11:00','end':'12:00'}
    assert 'category_ref' in proposed[1] and not proposed[1].get('category_key')
    assert call(client,'/api/assistant/preference-rules')['rules']==before
    assert not any(c['name']=='健身' for c in call(client,'/api/task-categories')['categories'])
    assert call(client,'/api/tasks')==[] and call(client,'/api/time-rules')==[]
    assert '已生成可编辑的档案修改' in result['delta']
    assert '入口' not in result['delta']
    assert ref_of(send(client,sid,'工作日，1h','details'))['id']==value['id']
    assert confirm(client,value).status_code==200
    assert confirm(client,value).status_code==200
    saved=call(client,'/api/assistant/preference-rules')
    category=next(c for c in saved['categories'] if c['name']=='健身')
    rules=[r for r in saved['rules'] if r['category_key']==category['key']]
    assert len(rules)==1 and rules[0]['weekdays']==[1,2,3,4,5]
    assert rules[0]['parameters']=={'start':'11:00','end':'12:00'}


def test_existing_category_is_reused_and_profile_edit_is_versioned(client,defaults_chat):
    category=call(client,'/api/task-categories',{'name':'健身'})
    value=ref_of(send(client,defaults_chat,'工作日上午11点健身，每次1h，帮我写入档案'))
    proposed=value['content']['operations']
    assert len(proposed)==1 and proposed[0]['category_key']==category['key']
    changed=deepcopy(value['content']);changed['operations'][0]['parameters']['end']='12:30'
    response=client.patch(f"/api/workspace/drafts/profile/{value['id']}",json={'expected_version':value['version'],'content':changed})
    assert response.status_code==200,response.text
    edited=response.json()
    assert edited['id']==value['id'] and edited['version']!=value['version']
    assert confirm(client,value).status_code==409
    assert confirm(client,edited).status_code==200
    saved=[r for r in call(client,'/api/assistant/preference-rules')['rules'] if r['category_key']==category['key']]
    assert len(saved)==1 and saved[0]['parameters']['end']=='12:30'


@pytest.mark.parametrize('failure',['empty','questions','unavailable','invalid_reference'])
def test_complete_user_preference_survives_incomplete_model_plan(client,defaults_chat,monkeypatch,failure):
    async def incomplete(request):
        if failure=='unavailable':raise claude_client.AIServiceError('AI_UNAVAILABLE')
        if failure=='invalid_reference':
            proposed=operations();proposed[-1]['category_ref']='draftcat:missing'
            return ToolPlan(calls=[{'name':'profile_draft','arguments':{'operations':proposed}}])
        return ToolPlan(questions=['星期和时长是什么？']) if failure=='questions' else ToolPlan()
    monkeypatch.setattr(conversation_tools,'plan',incomplete)
    result=send(client,defaults_chat,'工作日上午11点健身，每次1h，帮我写入档案')
    value=ref_of(result)
    assert value['content']['operations'][-1]['parameters']=={'start':'11:00','end':'12:00'}
    assert '本次操作未完成' not in result['delta']


@pytest.mark.parametrize('text',[
    '工作日上午11点健身，帮我写入档案',
    '每天健身1h，帮我写入档案',
    '工作日上午11点或者下午3点健身，每次1h，帮我写入档案',
])
def test_profile_recovery_does_not_invent_missing_or_ambiguous_fields(client,defaults_chat,text):
    result=send(client,defaults_chat,text)
    assert not any(r.get('draft') for r in result['content']['tools'])


@pytest.mark.parametrize('mutate',[
    lambda ops:ops[1].update(category_ref='draftcat:unknown'),
    lambda ops:ops[1].update(category_key='writing'),
    lambda ops:ops.append(deepcopy(ops[0])),
    lambda ops:ops.append({**ops[0],'temp_ref':'draftcat:second'}),
    lambda ops:ops[1].update(kind='ai_note',parameters={'text':'一个参考'}),
])
def test_category_reference_validation_never_creates_formal_rows(client,test_engine,mutate):
    proposed=operations();mutate(proposed)
    with Session(test_engine) as db:
        with pytest.raises(HTTPException):workspace_drafts.validate_business(db,'profile',proposed)
    assert not any(c['name']=='健身' for c in call(client,'/api/task-categories')['categories'])


def test_model_generated_category_and_preference_share_confirmation(client,test_engine):
    value=draft(client,test_engine,'profile',operations())
    assert len(value['content']['operations'])==2
    assert value['task_categories']
    assert confirm(client,value).status_code==200
    assert len([c for c in call(client,'/api/task-categories')['categories'] if c['name']=='健身'])==1


def test_disabled_preference_draft_preserves_user_choice(client,test_engine):
    proposed=operations();proposed[-1]['enabled']=False
    value=draft(client,test_engine,'profile',proposed)
    assert confirm(client,value).status_code==200
    saved=call(client,'/api/assistant/preference-rules')['rules']
    assert next(rule for rule in saved if rule['name']=='健身时间偏好')['enabled'] is False
