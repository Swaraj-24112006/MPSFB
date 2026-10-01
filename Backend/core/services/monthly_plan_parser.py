import csv
import io
import re
import logging
from typing import Union, BinaryIO, List, Dict, Any, Tuple
import openpyxl

logger = logging.getLogger(__name__)


class MonthlyPlanParser:
    """
    Parser for Monthly Plan bulk uploads.
    Supports:
    - Excel spreadsheets (.xlsx, .xlsm) via openpyxl
    - Comma-separated values (.csv) via Python csv module
    - Tab-separated values (.tsv or pasted text)
    - Delimiter auto-detection (tab, comma, semicolon)
    - Flexible column mapping with header detection
    - Skip header row if first cell contains fg/code/material
    - Per-row validation (fg_code must start with '7', monthly_target > 0)
    """

    @classmethod
    def parse(cls, file_or_text: Union[BinaryIO, bytes, str, io.BytesIO], month: str) -> Dict[str, Any]:
        """
        Parses input file or string content for the specified month.
        Returns a dictionary:
        {
            "total_rows": int,
            "valid_rows": [
                {
                    "row_index": int,
                    "fg_code": str,
                    "fg_description": str,
                    "customer_name": str,
                    "monthly_target": int,
                    "uom": str,
                    "custom_notes": str
                }, ...
            ],
            "error_rows": [
                {
                    "row_index": int,
                    "fg_code": str,
                    "reason": str
                }, ...
            ]
        }
        """
        raw_rows = cls._extract_raw_rows(file_or_text)
        if not raw_rows:
            return {
                "total_rows": 0,
                "valid_rows": [],
                "error_rows": [{"row_index": 0, "fg_code": "", "reason": "No data found in uploaded content."}]
            }

        # Check for header row
        has_header, header_indices = cls._inspect_header(raw_rows[0])
        data_rows = raw_rows[1:] if has_header else raw_rows

        valid_rows = []
        error_rows = []

        for idx, row in enumerate(data_rows, start=2 if has_header else 1):
            if not row or not any(cell.strip() for cell in row):
                continue

            extracted, error_reason = cls._parse_single_row(row, header_indices if has_header else None, idx)
            if error_reason:
                error_rows.append({
                    "row_index": idx,
                    "fg_code": extracted.get("fg_code", "") if extracted else "",
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
        Normalizes any input (Excel binary, CSV bytes, text) into a list of list of string cells.
        """
        # 1. Check if input is bytes / binary
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

        # 2. Check for Excel PK signature (ZIP header for .xlsx)
        if byte_content.startswith(b'PK\x03\x04'):
            try:
                wb = openpyxl.load_workbook(io.BytesIO(byte_content), data_only=True)
                sheet = wb.active
                excel_rows = []
                for row in sheet.iter_rows(values_only=True):
                    if row and any(c is not None and str(c).strip() != '' for c in row):
                        excel_rows.append([str(c).strip() if c is not None else '' for c in row])
                return excel_rows
            except Exception as ex:
                logger.warning(f"[MonthlyPlanParser] openpyxl failed, falling back to text: {ex}")

        # 3. Decode text with encoding fallbacks
        decoded_text = None
        for enc in ('utf-8-sig', 'utf-8', 'latin-1', 'cp1252'):
            try:
                decoded_text = byte_content.decode(enc)
                break
            except UnicodeDecodeError:
                continue

        if decoded_text is None:
            decoded_text = byte_content.decode('utf-8', errors='replace')

        # 4. Auto-detect delimiter
        lines = [line for line in decoded_text.splitlines() if line.strip()]
        if not lines:
            return []

        sample = "\n".join(lines[:10])
        tab_count = sample.count('\t')
        comma_count = sample.count(',')
        semi_count = sample.count(';')

        if tab_count > comma_count and tab_count >= semi_count:
            delimiter = '\t'
        elif semi_count > comma_count:
            delimiter = ';'
        else:
            delimiter = ','

        reader = csv.reader(io.StringIO(decoded_text), delimiter=delimiter)
        raw_rows = []
        for r in reader:
            clean_cells = [cell.strip().replace('\ufeff', '') for cell in r]
            if any(clean_cells):
                raw_rows.append(clean_cells)

        return raw_rows

    @classmethod
    def _inspect_header(cls, first_row: List[str]) -> Tuple[bool, Dict[str, int]]:
        """
        Determines whether the first row is a header row (checks if first cell or row
        contains 'fg', 'code', 'material', or 'part').
        Returns (is_header, column_indices_map).
        """
        if not first_row:
            return False, {}

        first_cell_lower = first_row[0].strip().lower()
        row_joined_lower = " ".join(first_row).lower()

        # Build plan rule: skip header row if first cell contains fg/code/material
        is_header = any(keyword in first_cell_lower for keyword in ('fg', 'code', 'material', 'part')) or (
            'target' in row_joined_lower and ('fg' in row_joined_lower or 'product' in row_joined_lower)
        )

        indices: Dict[str, int] = {}
        if is_header:
            for idx, cell in enumerate(first_row):
                c = cell.strip().lower().replace('_', ' ').replace('-', ' ')
                if any(k in c for k in ('fg code', 'part number', 'part no', 'material', 'fg')) and 'target' not in c and 'desc' not in c:
                    indices['fg_code'] = idx
                elif any(k in c for k in ('desc', 'description', 'name')) and 'cust' not in c:
                    indices['fg_description'] = idx
                elif any(k in c for k in ('customer', 'oem', 'client', 'segment')):
                    indices['customer_name'] = idx
                elif any(k in c for k in ('target', 'monthly target', 'plan', 'qty', 'quantity', 'volume')):
                    indices['monthly_target'] = idx
                elif any(k in c for k in ('uom', 'unit')):
                    indices['uom'] = idx
                elif any(k in c for k in ('note', 'remark', 'comment')):
                    indices['custom_notes'] = idx

        return is_header, indices

    @classmethod
    def _parse_single_row(
        cls,
        row: List[str],
        indices: Union[Dict[str, int], None],
        row_idx: int
    ) -> Tuple[Dict[str, Any], Union[str, None]]:
        """
        Parses and validates a single data row.
        Returns (extracted_dict, error_reason_or_none).
        """
        fg_code = ''
        fg_description = ''
        customer_name = ''
        target_raw = ''
        uom = 'PC'
        custom_notes = ''

        if indices and 'fg_code' in indices:
            # Header mapped extraction
            fg_code = row[indices['fg_code']] if indices['fg_code'] < len(row) else ''
            if 'fg_description' in indices and indices['fg_description'] < len(row):
                fg_description = row[indices['fg_description']]
            if 'customer_name' in indices and indices['customer_name'] < len(row):
                customer_name = row[indices['customer_name']]
            if 'monthly_target' in indices and indices['monthly_target'] < len(row):
                target_raw = row[indices['monthly_target']]
            if 'uom' in indices and indices['uom'] < len(row):
                uom = row[indices['uom']] or 'PC'
            if 'custom_notes' in indices and indices['custom_notes'] < len(row):
                custom_notes = row[indices['custom_notes']]
        else:
            # Positional fallback
            # 2 columns: FG Code, Target
            # 3 columns: FG Code, Customer / Desc, Target
            # 4 columns: FG Code, FG Desc, Customer, Target
            # 5 columns: FG Code, FG Desc, Customer, Target, UOM
            # 6+ columns: FG Code, FG Desc, Customer, Target, UOM, Notes
            fg_code = row[0] if len(row) > 0 else ''
            if len(row) == 2:
                target_raw = row[1]
            elif len(row) == 3:
                # Determine which column is target
                if cls._is_numeric(row[2]):
                    customer_name = row[1]
                    target_raw = row[2]
                elif cls._is_numeric(row[1]):
                    target_raw = row[1]
                    customer_name = row[2]
                else:
                    target_raw = row[2]
            elif len(row) == 4:
                fg_description = row[1]
                customer_name = row[2]
                target_raw = row[3]
            elif len(row) >= 5:
                fg_description = row[1]
                customer_name = row[2]
                target_raw = row[3]
                uom = row[4] or 'PC'
                if len(row) >= 6:
                    custom_notes = row[5]

        # Cleanup values
        fg_code = fg_code.strip().replace('"', '').replace("'", "")
        fg_description = fg_description.strip().replace('"', '')
        customer_name = customer_name.strip().replace('"', '')
        uom = uom.strip().replace('"', '') or 'PC'
        custom_notes = custom_notes.strip().replace('"', '')

        # Validation Rule 1: fg_code presence and starts with '7'
        if not fg_code:
            return {}, "FG Code is empty or missing."

        if not fg_code.startswith('7'):
            return {"fg_code": fg_code}, f"FG Code '{fg_code}' does not start with '7' (SAP Finished Goods rule)."

        if len(fg_code) > 30:
            return {"fg_code": fg_code}, f"FG Code '{fg_code}' too long (maximum 30 characters)."

        # Validation Rule 2: monthly_target must be numeric and > 0
        if not target_raw:
            return {"fg_code": fg_code}, "Monthly target is missing."

        try:
            cleaned_target_str = str(target_raw).replace(',', '').replace(' ', '').replace('₹', '').replace('$', '').strip()
            target_float = float(cleaned_target_str)
            monthly_target = int(round(target_float))
        except (ValueError, TypeError):
            return {"fg_code": fg_code}, f"Invalid monthly target number: '{target_raw}'."

        if monthly_target <= 0:
            return {"fg_code": fg_code}, f"Monthly target must be greater than 0 (got {monthly_target})."

        return {
            "row_index": row_idx,
            "fg_code": fg_code,
            "fg_description": fg_description,
            "customer_name": customer_name,
            "monthly_target": monthly_target,
            "uom": uom,
            "custom_notes": custom_notes,
        }, None

    @classmethod
    def validate_row(cls, row: dict, row_index: int = 1) -> Tuple[bool, str]:
        """
        Validates row dict against 5 rules:
        1. fg_code is non-empty -> "FG Code is required"
        2. fg_code starts with '7' -> "FG Code must start with '7' (SAP Finished Good rule)"
        3. fg_code max 30 chars -> "FG Code too long"
        4. monthly_target is numeric after stripping commas -> "Monthly Target must be a number"
        5. monthly_target > 0 -> "Monthly Target must be greater than 0"
        Returns (is_valid, error_reason).
        """
        fg_code = str(row.get('fg_code', '')).strip()
        if not fg_code:
            return False, "FG Code is required"
        if not fg_code.startswith('7'):
            return False, "FG Code must start with '7' (SAP Finished Good rule)"
        if len(fg_code) > 30:
            return False, "FG Code too long (maximum 30 characters)"

        raw_target = row.get('monthly_target')
        if raw_target is None or str(raw_target).strip() == '':
            return False, "Monthly Target is required"

        try:
            cleaned = str(raw_target).replace(',', '').replace(' ', '').replace('₹', '').replace('$', '').strip()
            target_val = float(cleaned)
        except (ValueError, TypeError):
            return False, "Monthly Target must be a number"

        if target_val <= 0:
            return False, "Monthly Target must be greater than 0"

        return True, ""

    @classmethod
    def parse_csv_file(cls, file_obj: Any) -> List[Dict[str, Any]]:
        """
        Parse CSV/Excel file and return list of row dictionaries.
        """
        result = cls.parse(file_obj, month='')
        return result.get('valid_rows', [])

    @classmethod
    def parse_pasted_text(cls, text: str) -> List[Dict[str, Any]]:
        """
        Parse pasted text (TSV/CSV) and return list of row dictionaries.
        """
        result = cls.parse(text, month='')
        return result.get('valid_rows', [])

    @classmethod
    def _is_numeric(cls, val: Any) -> bool:
        if val is None:
            return False
        clean = str(val).replace(',', '').replace(' ', '').strip()
        try:
            float(clean)
            return True
        except ValueError:
            return False
