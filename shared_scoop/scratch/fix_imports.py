import os
import re

def get_relative_prefix(file_path, base_dir='src'):
    # file_path is like ./src/app/(tabs)/dashboard.tsx
    # relative to src: app/(tabs)/dashboard.tsx
    # depth is 2 (app, (tabs))
    parts = file_path.split(os.sep)
    try:
        src_index = parts.index(base_dir)
        rel_parts = parts[src_index+1:-1]
        if not rel_parts:
            return './'
        return '../' * len(rel_parts)
    except ValueError:
        return './'

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    prefix = get_relative_prefix(filepath)
    # Replace @/ with prefix
    # We match from '@/' or require('@/') or import '@/...'
    
    # regex to match @/
    # wait, could be import '@/global.css'
    
    new_content = re.sub(r"(['\"])@/", r"\1" + prefix, content)

    if new_content != content:
        with open(filepath, 'w') as f:
            f.write(new_content)
        print(f"Updated {filepath}")

for root, _, files in os.walk('./src'):
    for file in files:
        if file.endswith('.ts') or file.endswith('.tsx'):
            process_file(os.path.join(root, file))
