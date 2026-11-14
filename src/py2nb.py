"""Convert a percent-format .py file to .ipynb.  Usage: python py2nb.py in.py out.ipynb"""
import json
import re
import sys


def convert(text):
    cells, kind, buf = [], None, []

    def flush():
        if kind and any(line.strip() for line in buf):
            body = "\n".join(buf).strip("\n")
            if kind == "markdown":
                body = "\n".join(re.sub(r"^# ?", "", ln) for ln in body.splitlines())
            cell = {"cell_type": kind, "metadata": {}, "source": body.splitlines(keepends=True)}
            if kind == "code":
                cell.update(outputs=[], execution_count=None)
            cells.append(cell)

    for line in text.splitlines():
        m = re.match(r"# %%( \[markdown\])?\s*$", line)
        if m:
            flush()
            kind, buf = ("markdown" if m.group(1) else "code"), []
        else:
            buf.append(line)
    flush()
    return {"cells": cells, "nbformat": 4, "nbformat_minor": 5,
            "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
                         "language_info": {"name": "python"}}}


if __name__ == "__main__":
    nb = convert(open(sys.argv[1], encoding="utf-8").read())
    json.dump(nb, open(sys.argv[2], "w", encoding="utf-8"), indent=1)
