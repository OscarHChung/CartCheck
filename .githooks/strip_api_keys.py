import sys, re
content = sys.stdin.read()
content = re.sub(r'(openaiKey|serpapiKey|claudeKey): [^\n"]+', lambda m: m.group(1) + ': ""', content)
sys.stdout.write(content)
