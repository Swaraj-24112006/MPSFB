import csv
import io
import re
import logging
from decimal import Decimal, InvalidOperation
from typing import Union, BinaryIO, List, Dict, Any, Optional

try:
    import openpyxl
except ImportError:
    openpyxl = None

logger = logging.getLogger(__name__)


class StockParser:
    """
    Parser for SAP MB52 Unrestricted Stock Snapshot reports.
    Supports:
    - Excel spreadsheets (.xlsx, .xlsm) via openpyxl
    - Comma-separated values (.csv) via Python csv module
    - Tab-separated values (.tsv or pasted text)
    - Delimiter auto-detection (tab, comma, semicolon, pipe)
    - Header detection & column mapping
    - Strip quotes & normalize whitespace
    - Skip header row if first cell lowercased contains 'part', 'material', 'stock'

    Minimum required columns: part_number
    Optional columns: description, unrestricted_stock, in_quality_insp,
                      blocked, safety_stock, uom, storage_location, plant
    """

    @classmethod
    def parse(
        cls,
        file_or_text: Union[BinaryIO, bytes, str, io.BytesIO],
    ) -> Dict[str, Any]:
        """
        Parses input file or text content into structured stock records.

        :param file_or_text: File buffer, bytes, or string content
        :return: Dict containing total_rows, valid_rows, and error_rows
        """
        raw_rows = cls._extract_raw_rows(file_or_text)
        if not raw_rows:
            return {
                "total_rows": 0,
                "valid_rows": [],
                "error_rows": [{"row_index": 0, "part_number": "", "reason": "No data found in uploaded content."}]
            }

        has_header, header_map = cls._inspect_header(raw_rows[0])
        data_rows = raw_rows[1:] if has_header else raw_rows

        valid_rows: List[Dict[str, Any]] = []
        error_rows: List[Dict[str, Any]] = []

        for idx, row in enumerate(data_rows, start=2 if has_header else 1):
            if not row or not any(str(cell).strip() for cell in row):
                continue

            extracted, error_reason = cls._parse_single_row(row, header_map if has_header else None, idx)
            if error_reason:
                error_rows.append({
                    "row_index": idx,
                    "part_number": extracted.get("part_number", "") if extracted else "",
                    "reason": error_reason
                })
            else:
                valid_rows.append(extracted)

        return {
            "total_rows": len(valid_rows) + len(error_rows),
            "valid_rows": valid_rows,
            "error_rows": error_rows
        }

    @classmethod
    def _extract_raw_rows(cls, file_or_text: Union[BinaryIO, bytes, str, io.BytesIO]) -> List[List[str]]:
        """
        Normalizes any input format into a 2D list of strings.
        """
        if isinstance(file_or_text, (bytes, bytearray)):
            byte_content = bytes(file_or_text)
        elif hasattr(file_or_text, 'read'):
            file_or_text.seek(0)
            read_data = file_or_text.read()
            if isinstance(read_data, str):
                byte_content = read_data.encode('utf-8')
            else:
                byte_content = read_data
        elif isinstance(file_or_text, str):
            byte_content = file_or_text.encode('utf-8')
        else:
            return []

        # Attempt 1: Parse as Excel (.xlsx)
        if openpyxl is not None:
            try:
                wb = openpyxl.load_workbook(io.BytesIO(byte_content), data_only=True, read_only=True)
                sheet = wb.active
                rows = []
                for sheet_row in sheet.iter_rows(values_only=True):
                    str_cells = [str(cell).strip() if cell is not None else "" for cell in sheet_row]
                    if any(str_cells):
                        rows.append(str_cells)
                wb.close()
                if rows:
                    return rows
            except Exception:
                pass  # Not an Excel file, fall through to text/csv

        # Attempt 2: Decode text content
        text_content = ""
        for encoding in ['utf-8-sig', 'utf-8', 'latin-1', 'cp1252']:
            try:
                text_content = byte_content.decode(encoding)
                break
            except UnicodeDecodeError:
                continue

        if not text_content:
            text_content = byte_content.decode('utf-8', errors='replace')

        # Auto-detect delimiter
        sample = text_content[:4096]
        delimiter = ','
        tab_count = sample.count('\t')
        comma_count = sample.count(',')
        semi_count = sample.count(';')
        pipe_count = sample.count('|')

        if tab_count > comma_count and tab_count > semi_count and tab_count > pipe_count:
            delimiter = '\t'
        elif semi_count > comma_count and semi_count > tab_count:
            delimiter = ';'
        elif pipe_count > comma_count and pipe_count > tab_count:
            delimiter = '|'

        rows = []
        try:
            reader = csv.reader(io.StringIO(text_content), delimiter=delimiter)
            for r in reader:
                cleaned = [cell.strip().strip('"').strip("'") for cell in r]
                if any(cleaned):
                    rows.append(cleaned)
        except Exception as e:
            logger.warning(f"csv.reader failed with delimiter '{delimiter}', falling back to line split: {e}")
            for line in text_content.splitlines():
                line = line.strip()
                if line:
                    rows.append([c.strip().strip('"').strip("'") for c in line.split(delimiter)])

        return rows

    @classmethod
    def _inspect_header(cls, first_row: List[str]) -> tuple:
        """
        Determines whether the first row is a header row, and maps column names to indices.
        Per specification: skip header if first cell lowercased contains part/material/stock.
        """
        if not first_row:
            return False, None

        first_cell = first_row[0].strip().lower()
        row_joined = " ".join(c.lower() for c in first_row)

        is_header = (
            'part' in first_cell or
            'material' in first_cell or
            'stock' in first_cell or
            'matnr' in first_cell or
            'unrestricted' in row_joined or
            'safety' in row_joined or
            'quality' in row_joined or
            'blocked' in row_joined
        )

        if not is_header:
            return False, None

        # Build column index mapping
        header_map: Dict[str, int] = {}
        for idx, cell in enumerate(first_row):
            norm = cell.strip().lower().replace('_', ' ').replace('-', ' ')
            norm_clean = re.sub(r'\s+', ' ', norm)

            if any(k in norm_clean for k in ['part number', 'part no', 'material no', 'matnr', 'material number']):
                if 'part_number' not in header_map:
                    header_map['part_number'] = idx
            elif any(k in norm_clean for k in ['description', 'material desc', 'maktx', 'name', 'desc']):
                if 'description' not in header_map:
                    header_map['description'] = idx
            elif any(k in norm_clean for k in ['unrestricted', 'available', 'on hand', 'free stock']):
                if 'unrestricted_stock' not in header_map:
                    header_map['unrestricted_stock'] = idx
            elif any(k in norm_clean for k in ['quality', 'qual insp', 'in quality', 'qi', 'in qi']):
                if 'in_quality_insp' not in header_map:
                    header_map['in_quality_insp'] = idx
            elif any(k in norm_clean for k in ['blocked', 'block', 'quarantine']):
                if 'blocked' not in header_map:
                    header_map['blocked'] = idx
            elif any(k in norm_clean for k in ['safety stock', 'safety', 'reorder', 'min stock']):
                if 'safety_stock' not in header_map:
                    header_map['safety_stock'] = idx
            elif any(k in norm_clean for k in ['uom', 'unit', 'meins', 'unit of measure']):
                if 'uom' not in header_map:
                    header_map['uom'] = idx
            elif any(k in norm_clean for k in ['sloc', 'storage loc', 'lgort', 'storage']):
                if 'storage_location' not in header_map:
                    header_map['storage_location'] = idx
            elif any(k in norm_clean for k in ['plant', 'werks']):
                if 'plant' not in header_map:
                    header_map['plant'] = idx
            elif any(k in norm_clean for k in ['stock date', 'opening date', 'opening stock date', 'as of date', 'baseline date', 'stock_date', 'date']):
                if 'stock_date' not in header_map:
                    header_map['stock_date'] = idx

        # If no explicit part_number mapping found, check first cell that has 'part' or 'material'
        if 'part_number' not in header_map:
            for idx, cell in enumerate(first_row):
                norm = cell.strip().lower()
                if 'part' in norm or 'material' in norm:
                    header_map['part_number'] = idx
                    break

        return True, header_map

    @classmethod
    def _parse_single_row(
        cls,
        row: List[str],
        header_map: Optional[Dict[str, int]],
        row_index: int
    ) -> tuple:
        """
        Parses a single row using either the header map or positional fallback.
        Positional fallback:
          [0] part_number, [1] description, [2] unrestricted_stock,
          [3] in_quality_insp, [4] blocked, [5] safety_stock,
          [6] uom, [7] storage_location, [8] plant, [9] stock_date
        """
        def get_val(key: str, default_pos: int, fallback: str = '') -> str:
            if header_map and key in header_map:
                idx = header_map[key]
                if idx < len(row):
                    return row[idx].strip()
            if default_pos < len(row):
                return row[default_pos].strip()
            return fallback

        # Extract values
        part_no = get_val('part_number', 0)
        desc = get_val('description', 1, '')
        stock_str = get_val('unrestricted_stock', 2, '0')
        qi_str = get_val('in_quality_insp', 3, '0')
        blocked_str = get_val('blocked', 4, '0')
        safety_str = get_val('safety_stock', 5, '0')
        uom = get_val('uom', 6, 'PC') or 'PC'
        sloc = get_val('storage_location', 7, 'SL01') or 'SL01'
        plant = get_val('plant', 8, '1001') or '1001'
        stock_date_raw = get_val('stock_date', 9, '')

        parsed_stock_date = None
        if stock_date_raw:
            from datetime import datetime
            for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y', '%Y/%m/%d'):
                try:
                    parsed_stock_date = datetime.strptime(stock_date_raw.strip(), fmt).date()
                    break
                except ValueError:
                    pass

        extracted = {
            "row_index": row_index,
            "part_number": part_no,
            "material_description": desc,
            "unrestricted_stock": Decimal(0),
            "in_quality_insp": Decimal(0),
            "blocked": Decimal(0),
            "safety_stock": Decimal(0),
            "uom": uom,
            "storage_location": sloc,
            "plant": plant,
            "stock_date": parsed_stock_date,
        }

        # Validate part_number
        if not part_no:
            return extracted, f"Row {row_index}: Part Number is required."

        # Default description if blank
        if not desc:
            extracted["material_description"] = f"Part {part_no}"

        # Parse numeric fields
        numeric_fields = [
            ('unrestricted_stock', stock_str, False),
            ('in_quality_insp', qi_str, True),
            ('blocked', blocked_str, True),
            ('safety_stock', safety_str, True),
        ]
        for field_name, raw_val, allow_zero_default in numeric_fields:
            clean_val = raw_val.replace(',', '').replace(' ', '') if raw_val else '0'
            if not clean_val:
                clean_val = '0'
            try:
                dec_val = Decimal(clean_val)
                if dec_val < 0:
                    return extracted, f"Row {row_index}: {field_name} cannot be negative (got '{raw_val}')."
                extracted[field_name] = dec_val
            except (InvalidOperation, ValueError):
                if allow_zero_default:
                    extracted[field_name] = Decimal(0)
                else:
                    return extracted, f"Row {row_index}: Invalid {field_name} value '{raw_val}'."

        return extracted, None
