"""Recover a fully specified recurring preference from the user's own words."""
import re

from . import ai_skills, draft_defaults
from .assistant_clock import assistant_now
from .taxonomy import categories_payload, rules_payload


def preference_operations(db, request):
    # Model planning handles general profile changes. Recovery only covers a
    # complete, unambiguous time preference in an unresolved profile workflow.
    users=[ai_skills.active_text(item['text']) for item in request.get('history', [])[-8:]
        if item.get('role')=='user']+[ai_skills.active_text(request['message'])]
    anchor=next((i for i in range(len(users)-1,-1,-1)
        if ai_skills.select_skills(users[i]).expected=='profile'),None)
    if anchor is None:return None
    texts=users[anchor:]
    if anchor and re.search(r'这个|这一|刚才|上面|之前|该偏好',users[anchor]):
        texts=[users[anchor-1],*texts]
    combined='。'.join(texts)
    if re.search(r'有课|课表|保护|不能|不要|避开|修改|更新|停用|取消|删除|或者|还是|跨天|次日|第二天|和|与|以及|同时|分别|、',combined):return None
    weekdays=None
    start=None
    minutes=None
    activity=None
    categories=categories_payload(db)
    for text in texts:
        days=None
        if '工作日' in text:days=[1,2,3,4,5]
        elif '周末' in text:days=[6,7]
        elif re.search(r'每天|每日',text):days=list(range(1,8))
        else:
            matches=re.findall(r'(?:周|星期|礼拜)([一二三四五六日天])',text)
            if matches:
                indexes=['一二三四五六日'.index(day.replace('天','日'))+1 for day in matches]
                days=sorted(set(indexes))
                if re.search(r'(?:周|星期|礼拜)[一二三四五六日天]\s*(?:到|至|[-–])',text):
                    if len(indexes)!=2 or indexes[0]>=indexes[1]:return None
                    days=list(range(days[0],days[-1]+1))
        if days is not None:weekdays=days
        at=draft_defaults.clock(text)
        if at:start=at
        interval=draft_defaults.clock_interval(text,assistant_now())
        if len(list(draft_defaults.CLOCK_PATTERN.finditer(text)))>(2 if interval else 1):return None
        length=draft_defaults.duration(text)
        if interval:
            if length is not None and length!=interval['duration_minutes']:return None
            start=interval['start_time'];length=interval['duration_minutes']
        if length is not None:minutes=length
        # Reuse a real named category, or extract a short activity directly
        # after the user's clock. Assistant suggestions never supply facts.
        named=[row['name'] for row in categories if row['name'] in text and row['name']!='其他']
        if len(named)>1:return None
        if named:activity=named[0]
        elif at:
            match=draft_defaults.CLOCK_PATTERN.search(text)
            end_position=interval['span'][1] if interval else match.end()
            tail=re.split(r'[，,。；;\n]|持续|时长|每次|大概|大约|预计',text[end_position:],maxsplit=1)[0]
            tail=re.sub(r'^(?:开始|去|进行|做|用来|用于|的|\s)+','',tail)
            tail=re.sub(r'(?:比较|更)?(?:合适|适合|比较好|最好|挺好)$','',tail).strip()
            if re.fullmatch(r'[\u4e00-\u9fffA-Za-z]{2,16}',tail) and not re.search(r'档案|偏好|草案|小时|分钟|工作日|每天|周末|到|还是|或者',tail):
                activity=tail
    if not activity or not weekdays or not start or minutes is None:return None
    begin=int(start[:2])*60+int(start[3:])
    end=begin+minutes
    if not 0<minutes<=1440 or not begin<end<1440:return None
    parameters={'start':start,'end':f'{end//60:02}:{end%60:02}'}
    category=next((row for row in categories if row['name'].casefold()==activity.casefold()),None)
    if category and not category['active']:return None
    if category and any(rule['kind']=='prefer_time' and rule.get('category_key')==category['key']
        and rule.get('weekdays')==weekdays and rule['parameters']==parameters and rule['enabled']
        for rule in rules_payload(db)):return None
    reference={'category_key':category['key']} if category else {'category_ref':'draftcat:preference'}
    operations=[] if category else [{'op':'create_category','name':activity,'temp_ref':'draftcat:preference'}]
    operations.append({'op':'create_preference_rule','name':activity+'时间偏好','kind':'prefer_time',
        **reference,'weekdays':weekdays,'parameters':parameters})
    return operations
