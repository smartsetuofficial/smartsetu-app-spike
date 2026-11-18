# Reference token ids from the Hugging Face Rust tokenizer (python package "tokenizers"), same tokenizer.json. The JS tokenizer must give the same ids.
import json
import tokenizers
from tokenizers import Tokenizer
t = Tokenizer.from_file('models/tokenizer.json')
s = json.load(open('smoke/sentences.json', encoding='utf-8'))
json.dump({'tokenizers_version': tokenizers.__version__, 'ids': {x: t.encode(x).ids for x in s}}, open('ref_ids.json', 'w', encoding='utf-8'), ensure_ascii=False)
print('python tokenizers', tokenizers.__version__, 'sentences', len(s))
