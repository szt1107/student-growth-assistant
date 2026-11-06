"""Lightweight natural-language routing. No database or model imports."""
import re

READ_TOOLS = frozenset({'attention', 'time_rules', 'task_execution'})


def natural_operation(text):
    # Definitions and hypothetical statements are handled without mutations.
    if re.search(r'是什么意思|什么叫|怎么理解|如何实现|怎么实现|会怎么处理', text):
        return None
    if re.search(r'(先做|优先做|先处理|优先处理).*(什么|哪|建议)|优先级|有哪些空档|有没有空|剩余时间|任务进度|执行记录|计时情况|有哪些任务|查看.{0,8}(课表|课程|保护时间)|什么时候上课', text) and not re.search(r'复盘|整理|生成|记录.*(完成|投入)|创建|新增|调整|修改|暂停|开始|结束|继续|做完|花了',text):
        return 'query'
    rule = r'课程|课表|有.{0,16}课|上.{0,16}课|午休|保护时间|休息时间|留空|不排任务'
    if re.search(rule, text) and re.search(r'每[天周]|周[一二三四五六日天].*(有课|上课)|记到课表|加入课表|添加|新增|修改|改成|调整|停用|取消|删除|留出来|别排任务|不要安排|不要排任务|不排任务|保护', text):
        return 'profile'
    if re.search(r'(开始|暂停|继续|恢复|结束|停止).{0,16}计时|计时.{0,8}(开始|暂停|继续|结束)', text):
        return 'feedback'
    if re.search(r'做完了|写完了|完成了.{0,12}(任务|作业|论文|报告)|只做了|做了一半|还剩.{0,8}(分钟|小时)|没做.{0,20}(推迟|记录|记一下)|花了.{0,8}(分钟|小时)', text):
        return 'feedback'
    if re.search(r'分解|分几步|分成.{0,8}(小事|小项|部分)|不知道从哪开始.{0,12}(帮我|怎么)', text):
        return 'task'
    if re.search(r'帮我.{0,8}(腾出|挪到|留出).{0,16}(小时|分钟|时间)|帮我.{0,8}(挪一下|换个时间)|帮我.{0,8}(做|制定|定).{0,16}计划|帮我计划', text):
        return 'schedule'
    return None


def protection_request(text):
    """'午休别排任务' is a requested constraint, not a ban on this draft."""
    return bool(re.search(r'(午休|休息时间|保护时间).*(留出来|不要安排|别排任务|不要排任务|不排任务)', text)) and not re.search(r'(不要|别|先不).*(记录|创建|添加|修改|保存|生成|保护)', text)
