"""Local bounded OCR and typed evidence candidates. Evidence text is not a command."""
import base64
import csv
import hashlib
import io
import os
import re
import shutil
import struct
import subprocess
import tempfile
import threading
from pathlib import Path
from .domain import require, Problem, CURRENCIES

ROOT=Path(__file__).resolve().parents[2]
SLOT=threading.BoundedSemaphore(1)

def extract(data):
    text=data.get("text","")
    require(isinstance(text,str) and len(text)<=20000,"TEXT_LIMIT","凭证文本最多20000字。")
    boxes=[];source="evidence_text"
    raw=text.encode()
    if data.get("image_base64"):
        encoded=data["image_base64"]
        require(isinstance(encoded,str) and len(encoded)<=7000000,"FILE_LIMIT","图片限5MiB。")
        try:raw=base64.b64decode(encoded,validate=True)
        except (ValueError,TypeError) as exc:raise Problem("INVALID_IMAGE","图片编码无效。") from exc
        require(len(raw)<=5*1024*1024,"FILE_LIMIT","图片限5MiB。")
        width=height=0
        if raw.startswith(b"\x89PNG\r\n\x1a\n") and len(raw)>=24:width,height=struct.unpack(">II",raw[16:24]);suffix=".png"
        elif raw.startswith(b"\xff\xd8"):
            suffix=".jpg";stream=io.BytesIO(raw[2:])
            while stream.tell()<len(raw)-2:
                marker=stream.read(2);size=stream.read(2)
                if len(marker)!=2 or marker[0]!=255 or len(size)!=2:break
                length=struct.unpack(">H",size)[0]
                if marker[1] in {0xC0,0xC1,0xC2}:
                    body=stream.read(5)
                    if len(body)==5:height,width=struct.unpack(">HH",body[1:])
                    break
                if length<2:break
                stream.seek(length-2,1)
        else:raise Problem("FILE_TYPE","只接受PNG/JPEG；银行PDF请转图片或CSV。")
        require(0<width*height<=25000000 and max(width,height)<=12000,"PIXEL_LIMIT","图片尺寸无效或超限。")
        executable=shutil.which("tesseract")
        require(executable is not None,"OCR_UNAVAILABLE","未安装Tesseract；可以粘贴凭证文本。",503)
        models=ROOT/"models/ocr"
        require((models/"chi_sim.traineddata").is_file() and (models/"eng.traineddata").is_file(),"OCR_LANGUAGE_UNAVAILABLE","中文语言包缺失，请安装本地识别数据或使用文本。",503)
        require(SLOT.acquire(False),"OCR_BUSY","本地OCR正在处理另一张图片，请稍后重试。",503)
        try:
            with tempfile.TemporaryDirectory(prefix="wallet-evidence-") as directory:
                path=Path(directory)/("input"+suffix);path.write_bytes(raw)
                try:run=subprocess.run([executable,str(path),"stdout","--tessdata-dir",str(models),"-l","chi_sim+eng","--psm","6","-c","tessedit_create_tsv=1"],capture_output=True,timeout=25,env={**os.environ,"OMP_THREAD_LIMIT":"1"})
                except subprocess.TimeoutExpired as exc:raise Problem("OCR_TIMEOUT","识别超时，请缩小图片或粘贴文字。",503) from exc
                require(run.returncode==0,"OCR_FAILED","图片无法识别，请对照原图补字段。")
                lines={}
                for row in csv.DictReader(io.StringIO(run.stdout.decode("utf-8",errors="replace")),delimiter="\t"):
                    if not row.get("text","").strip():continue
                    boxes.append({"text":row["text"],"page":int(row["page_num"]),"x":int(row["left"]),"y":int(row["top"]),"width":int(row["width"]),"height":int(row["height"]),"raw_score":row["conf"]})
                    key=(row["page_num"],row["block_num"],row["par_num"],row["line_num"])
                    lines.setdefault(key,[]).append(row["text"])
                    boxes[-1]["line_number"]=len(lines)
                text="\n".join(" ".join(words) for words in lines.values())
                source="tesseract-local"
        finally:SLOT.release()
    require(text.strip(),"RECEIPT_EMPTY","未提取到文字，请粘贴文本或手工补齐。")
    return {"source":source,"requires_ocr":True,"raw_text":text,"word_boxes":boxes,"quality":"UNCALIBRATED_USER_REVIEW","sha256":hashlib.sha256(raw).hexdigest(),"language":"chi_sim+eng","limitations":["识别分数未校准，所有字段需人工复核。","图片仅临时处理，不发送到云端。"]}

def parse(evidence,doc_type,account=None,currency=None,timezone="Australia/Sydney"):
    require(doc_type in {"receipt","bank","investment"},"DOCUMENT_TYPE","请选择消费、流水或投资凭证。")
    raw=evidence["raw_text"]
    text=re.sub(r"(?<=[\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])","",raw)
    text=text.replace(",","")
    explicit=next((c for c in CURRENCIES if re.search(r"\b"+c+r"\b",text,re.I)),None)
    code=explicit or currency or (account["currency"] if account else None)
    date=re.search(r"(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})",text)
    day=f"{date[1]}-{int(date[2]):02d}-{int(date[3]):02d}" if date else None
    if doc_type=="investment":
        def number(pattern):
            m=re.search(pattern+r"\s*[:：]?\s*([+-]?\d+(?:\.\d+)?)",text,re.I)
            return m[1] if m else None
        name=re.search(r"(?:基金名称|投资名称|名称|fund name|investment name)\s*[:：]\s*([^\n]+)",text,re.I)
        fields={"name":name[1].strip() if name else None,"currency":code,"observed_at":day+"T00:00:00+00:00" if day else None,
                "market_value":number(r"(?:市值|持有金额|market value)"),"cost_basis":number(r"(?:成本|cost basis)"),"reported_gain":number(r"(?:累计收益|cumulative gain)"),"daily_gain":number(r"(?:今日收益|daily gain)"),"reported_semantics":"CUMULATIVE","fees_taxes_known":False}
        return [{"op_id":"o1","kind":"investment_observation","fields":fields,"selected":True,"resource_id":None,"resource_type":"investment","source_span":raw,"evidence":{**evidence,"date_precision":"DAY"},"errors":[]}]
    lines=text.splitlines() if doc_type=="bank" else [text]
    result=[]
    for index,line in enumerate(lines):
        if doc_type=="bank" and not re.search(r"20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}",line):continue
        if doc_type=="bank" and re.search(r"(?:opening|closing) balance|期初余额|期末余额",line,re.I) and not re.search(r"收入|支出|income|expense|transfer",line,re.I):continue
        d=re.search(r"(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})",line)
        row_day=f"{d[1]}-{int(d[2]):02d}-{int(d[3]):02d}" if d else day
        direction="income" if re.search(r"收入|工资|income|salary",line,re.I) else "expense" if re.search(r"支出|消费|expense|debit|paid",line,re.I) or doc_type=="receipt" else "needs_classification"
        if re.search(r"转账|还款|transfer|repayment",line,re.I):direction="transfer"
        pattern=r"(?:收入|支出|转账|income|expense|debit|credit|transfer)\s*[:：]?\s*([+-]?\d+(?:\.\d+)?)" if doc_type=="bank" else r"(?:合计|总计|实付|total|amount paid)\s*[:：]?\s*([+-]?\d+(?:\.\d+)?)"
        amount=re.search(pattern,line,re.I)
        row_code=next((c for c in CURRENCIES if re.search(r"\b"+c+r"\b",line,re.I)),None) or code
        without_date=re.sub(r"20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}","",line)
        before_balance=re.split(r"余额|balance",without_date,flags=re.I)[0]
        if not amount and doc_type=="bank":amount=re.search(r"([+-]?\d+(?:\.\d+)?)\s*(?:AUD|CNY|USD|EUR|GBP|JPY)\b",before_balance,re.I)
        merchant=line.splitlines()[0].strip() if doc_type=="receipt" else re.sub(r"(?:收入|支出|转账|income|expense|debit|credit|transfer)\s*[:：]?\s*[+-]?\d+(?:\.\d+)?|AUD|CNY|USD|余额.*|balance.*", "",before_balance,flags=re.I).strip()
        category="Dining" if re.search(r"咖啡|coffee|餐饮|dining",line,re.I) else "Groceries" if doc_type=="receipt" else "Income" if direction=="income" else "Other"
        fields={"kind":direction,"amount":amount[1].lstrip("+") if amount else None,"date":row_day,"currency":row_code,"merchant":merchant[:120] or ("Transfer" if direction=="transfer" else None),"category":category,
                "account_id":account["id"] if account and account["currency"]==row_code else None,"counterparty_id":None,"refund_of":None,"external_id":None,"mock":False}
        evidence_row={**evidence,"source_span":line,"row_number":index+1,"field_locations":{k:[b for b in evidence["word_boxes"] if (doc_type=="receipt" or b.get("line_number")==index+1) and fields.get(k) and str(fields[k]) in b["text"]] for k in ("amount","currency","date")}}
        result.append({"op_id":f"o{len(result)+1}","kind":"create_draft","fields":fields,"selected":True,"resource_type":"candidate","source_span":line,"source_key":"evidence:"+evidence["sha256"]+":"+str(index),"evidence":evidence_row})
    require(result and len(result)<=20,"EVIDENCE_ROWS","没有可识别行，或超过20行，请使用CSV或拆分图片。")
    return result
