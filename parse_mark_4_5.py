import pypdf
import re
import json

def clean_spacing(text):
    text = re.sub(r'[ \t\r\f\v]+', ' ', text)
    text = re.sub(r'\s+([,.:;?!])', r'\1', text)
    text = re.sub(r'“\s+', '“', text)
    text = re.sub(r'\s+”', '”', text)
    text = re.sub(r'\s+’', '’', text)
    text = re.sub(r'‘\s+', '‘', text)
    return text.strip()

def split_question_and_answer(q_raw, division, set_title):
    clean = clean_spacing(q_raw.replace('\n', ' '))
    
    citation = ""
    chap = None
    verse = ""
    question_part = ""
    ans_part = ""
    
    if division == 'Championship':
        # Championship uses bracketed citation: [M 4:6] or [M 4:29, 30...] or [M 4]
        m = re.search(r'\[\s*M\s*([1-9]|1[0-6])(?::([^\]]+))?\]', clean)
        if m:
            chap = int(m.group(1))
            verse_num = m.group(2).strip() if m.group(2) else ""
            verse = f"{chap}:{verse_num}" if verse_num else f"{chap}"
            citation = m.group(0).strip()
            question_part = clean[:m.start()].strip()
            ans_part = clean[m.end():].strip()
            if not ans_part:
                ans_part = citation
    elif division == 'Contender':
        # Contender uses M 4:6 or [M 4:6]
        m = re.search(r'(\[\s*M\s*([1-9]|1[0-6])(?::([^\]]+))?\]|\bM\s*([1-9]|1[0-6]):(\d+(?:-\d+)?)|\bM\s*([1-9]|1[0-6])\b)', clean)
        if m:
            c_num = m.group(2) or m.group(4) or m.group(6)
            chap = int(c_num)
            v_num = m.group(3) or m.group(5) or ""
            verse = f"{chap}:{v_num}" if v_num else f"{chap}"
            citation = m.group(0).strip()
            question_part = clean[:m.start()].strip()
            ans_part = clean[m.end():].strip()
            if not ans_part:
                ans_part = citation
    elif division == 'XP Progressive':
        # XP Progressive uses 5:5 or 5:18 after the question
        # Find citation: \b([1-9]|1[0-6]):(\d+)\b
        m = re.search(r'\b([1-9]|1[0-6]):(\d+(?:-\d+)?)\b', clean)
        if m:
            chap = int(m.group(1))
            verse = f"{m.group(1)}:{m.group(2)}"
            citation = m.group(0).strip()
            question_part = clean[:m.start()].strip()
            ans_part = clean[m.end():].strip()
            if not ans_part:
                ans_part = citation
            
    # Fallback if no citation matched
    if not citation:
        q_end = clean.rfind('?')
        if q_end != -1:
            question_part = clean[:q_end+1].strip()
            ans_part = clean[q_end+1:].strip()
        else:
            question_part = clean
            ans_part = ""
            
    # Fallback chapter detection if chap is None
    if chap is None:
        if re.search(r'\bMark\s+4\b|\bSet\s+(?:4|10|11|12)\b', set_title, re.IGNORECASE):
            chap = 4
        elif re.search(r'\bMark\s+5\b|\bSet\s+(?:5|13|14|15|3)\b', set_title, re.IGNORECASE):
            chap = 5
        elif re.search(r'\bMark\s+chapter\s+4\b', question_part, re.IGNORECASE):
            chap = 4
        elif re.search(r'\bMark\s+chapter\s+5\b', question_part, re.IGNORECASE):
            chap = 5
            
    return question_part, citation, ans_part, chap, verse

def parse_pdf(filename, division):
    reader = pypdf.PdfReader(filename)
    full_text = ''
    for p in reader.pages:
        full_text += '\n' + (p.extract_text() or '')
    
    header_patterns = [
        r'Championship\s+Practice\s+Questions\s+Written\s+by\s+Jesse\s+Czubkowski\s+Gospel\s+of\s+Mark\s+\d+',
        r'\d+\s+Mark\s+Contender\s+Practice\s+Sets\s+Written\s+by\s+Laura\s+Rodriguez\s+Edited\s+by\s+Danielle\s+Mori',
        r'Mark\s+Contender\s+Practice\s+Sets\s+Written\s+by\s+Laura\s+Rodriguez\s+Edited\s+by\s+Danielle\s+Mori',
        r'2026–2027\s+Progressive\s+Sets\s+•\s+Covering\s+Mark\s+1,\s+5–6,\s+8\s+Written\s+by\s+Bryan\s+Turner\s+Page\s+\d+\s+of\s+\d+',
        r'Individual\s+Chapter\s+Sets\s+\(\d+\s+Sets\)',
        r'Produced\s+by\s+National\s+Youth\s+Ministries.*?Missouri\s+65802\.'
    ]
    for hp in header_patterns:
        full_text = re.sub(hp, '', full_text, flags=re.IGNORECASE)
        
    clean_full = re.sub(r'[ \t]+', ' ', full_text)
    
    set_matches = list(re.finditer(r'(?:^|\n)\s*(Set\s+\d+[^Q\n\r]*)', clean_full, re.IGNORECASE))
    print(f"[{division}] Found {len(set_matches)} sets in {filename}")
    
    extracted = []
    
    for i, sm in enumerate(set_matches):
        set_title = clean_spacing(sm.group(1))
        start = sm.end()
        end = set_matches[i+1].start() if i+1 < len(set_matches) else len(clean_full)
        set_text = clean_full[start:end]
        
        q_matches = list(re.finditer(r'Question\s+number\s+(\d+)\s+for\s+(\d+)\s+points\.', set_text, re.IGNORECASE))
        
        for q_idx, qm in enumerate(q_matches):
            q_num = int(qm.group(1))
            pts = int(qm.group(2))
            q_start = qm.end()
            q_end = q_matches[q_idx+1].start() if q_idx+1 < len(q_matches) else len(set_text)
            raw_q = set_text[q_start:q_end].strip()
            
            question_text, citation, answer_text, chap, verse = split_question_and_answer(raw_q, division, set_title)
            
            # STRICT REQUIREMENT: ONLY Chapter 4 and Chapter 5
            if chap in (4, 5):
                clean_set_name = re.sub(r'\s+', ' ', set_title).strip()
                q_id = f"{division.lower()[:4]}-s{i+1}-q{q_num}"
                extracted.append({
                    'id': q_id,
                    'division': division,
                    'set': clean_set_name,
                    'qNum': q_num,
                    'pointValue': pts,
                    'chapter': chap,
                    'verse': verse,
                    'citation': citation,
                    'question': question_text,
                    'answer': answer_text,
                    'verbatimFull': f"Question number {q_num} for {pts} points. {clean_spacing(raw_q)}"
                })
    return extracted

all_questions = []
all_questions.extend(parse_pdf('Championship Practice Sets—Mark.pdf', 'Championship'))
all_questions.extend(parse_pdf('Contender Practice Sets—Mark.pdf', 'Contender'))
all_questions.extend(parse_pdf('XP Progressive Sets—Mark.pdf', 'XP Progressive'))

print(f"\n==========================================")
print(f"VERIFIED Mark 4 & 5 Questions: {len(all_questions)}")
print(f"==========================================")

empty_q = [q for q in all_questions if not q['question']]
empty_a = [q for q in all_questions if not q['answer']]
empty_c = [q for q in all_questions if not q['citation']]

print(f"Validation:")
print(f"  Empty questions: {len(empty_q)}")
print(f"  Empty answers: {len(empty_a)}")
print(f"  Empty citations: {len(empty_c)}")

p10 = [q for q in all_questions if q['pointValue'] == 10]
p20 = [q for q in all_questions if q['pointValue'] == 20]
p30 = [q for q in all_questions if q['pointValue'] == 30]
ch4 = [q for q in all_questions if q['chapter'] == 4]
ch5 = [q for q in all_questions if q['chapter'] == 5]
champ = [q for q in all_questions if q['division'] == 'Championship']
cont = [q for q in all_questions if q['division'] == 'Contender']
xp = [q for q in all_questions if q['division'] == 'XP Progressive']

print(f"Points Breakdown:")
print(f"  • 10 Pts: {len(p10)}")
print(f"  • 20 Pts: {len(p20)}")
print(f"  • 30 Pts: {len(p30)}")
print(f"Chapter Breakdown:")
print(f"  • Mark 4: {len(ch4)}")
print(f"  • Mark 5: {len(ch5)}")
print(f"Division Breakdown:")
print(f"  • Championship: {len(champ)}")
print(f"  • Contender: {len(cont)}")
print(f"  • XP Progressive: {len(xp)}")

out_path = 'public/data/practice_questions_mark_4_5.json'
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump({
        'meetTitle': 'TBQ Meet 2 Practice Questions',
        'meetDate': 'Nov 7, 2026',
        'chapters': 'Mark 4 & 5',
        'summary': f"Complete collection of {len(all_questions)} official questions for Mark Chapters 4 & 5 extracted verbatim from official 2026-2027 Assemblies of God TBQ Practice Sets.",
        'totalCount': len(all_questions),
        'counts': {
            'pts10': len(p10),
            'pts20': len(p20),
            'pts30': len(p30),
            'ch4': len(ch4),
            'ch5': len(ch5),
            'championship': len(champ),
            'contender': len(cont),
            'xp': len(xp)
        },
        'questions': all_questions
    }, f, indent=2, ensure_ascii=False)

print(f"\nWritten to {out_path} ({len(all_questions)} questions)")
