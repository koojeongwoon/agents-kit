import re
import os

def split_file(input_file):
    with open(input_file, 'r', encoding='utf-8') as f:
        content = f.read()

    # Create routes dir
    os.makedirs('routes', exist_ok=True)

    # We will use a simple parser to extract top level blocks
    blocks = []
    current_block = ""
    brace_level = 0
    paren_level = 0
    in_string = False
    string_char = None
    in_comment = False
    in_multiline_comment = False

    i = 0
    block_start = 0
    while i < len(content):
        c = content[i]
        
        if in_multiline_comment:
            if c == '*' and i + 1 < len(content) and content[i+1] == '/':
                in_multiline_comment = False
                i += 2
                continue
            i += 1
            continue
            
        if in_comment:
            if c == '\n':
                in_comment = False
            i += 1
            continue
            
        if in_string:
            if c == '\\':
                i += 2
                continue
            if c == string_char:
                in_string = False
            i += 1
            continue
            
        if c == '/' and i + 1 < len(content):
            if content[i+1] == '/':
                in_comment = True
                i += 2
                continue
            elif content[i+1] == '*':
                in_multiline_comment = True
                i += 2
                continue
                
        if c in ["'", '"', '`']:
            in_string = True
            string_char = c
            i += 1
            continue
            
        if c == '{':
            brace_level += 1
        elif c == '}':
            brace_level -= 1
        elif c == '(':
            paren_level += 1
        elif c == ')':
            paren_level -= 1
            
        # Check if we reached the end of a top level statement
        # This can be a newline when brace_level == 0 and paren_level == 0
        if brace_level == 0 and paren_level == 0 and c == '\n':
            # Check if previous non-whitespace character was a semicolon or brace
            # Actually just splitting by \n at top level might split multi-line statements.
            pass

        i += 1

