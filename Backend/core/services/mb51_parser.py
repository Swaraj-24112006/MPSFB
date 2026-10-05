import csv
import io
import re
import logging
from decimal import Decimal, InvalidOperation
from typing import Union, BinaryIO, List, Dict, Any, Optional, Tuple
import openpyxl

from core.services.week_mapping_service import WeekMappingService

logger = logging.getLogger(__name__)


class MB51Parser:
    """
    Parser for SAP MB51 Material Movement Document reports.
    Supports:
    - Excel spreadsheets (.xlsx, .xlsm, .xls) via openpyxl
    - Comma-separated values (.csv) via Python csv module
    - Tab-separated values (.tsv or pasted text)
    - Delimiter auto-detection (tab, comma, semicolon, pipe)
    - Header detection & column mapping
    - Strip quotes & normalize whitespace
    - Skip header row if first cell contains mat/mvt/doc
    - Flexible column order with fallback to standard positional format:
      [0] material_document, [1] posting_date, [2] movement_type, [3] part_number,
      [4] material_description, [5] quantity, [6] uom, [7] storage_location,
      [8] vendor_customer, [9] plant, [10] po_order_number
    """

    @classmethod
    def parse(
        cls,
        file_or_text: Union[BinaryIO, bytes, str, io.BytesIO],
        weeks: Optional[Any] = None
    ) -> Dict[str, Any]:
        """
        Parses input file or text content into structured transaction records.

        :param file_or_text: File buffer, bytes, or string content
        :param weeks: Optional list or QuerySet of WeekDefinition objects
        :return: Dict containing total_rows, valid_rows, and error_rows
        """
        raw_rows = cls._extract_raw_rows(file_or_text)
        if not raw_rows:
            return {
                "total_rows": 0,
                "valid_rows": [],
                "error_rows": [{"row_index": 0, "material_document": "", "reason": "No data found in uploaded content."}]
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
                    "material_document": extracted.get("material_document", "") if extracted else "",
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
    def _inspect_header(cls, first_row: List[str]) -> Tuple[bool, Optional[Dict[str, int]]]:
        """
        Determines whether the first row is a header row, and maps column names to indices.
        Per specification: skip header if first cell lowercased contains mat/mvt/doc.
        """
        if not first_row:
            return False, None

        first_cell = first_row[0].strip().lower()
        row_joined = " ".join(c.lower() for c in first_row)

        is_header = (
            'mat' in first_cell or
            'mvt' in first_cell or
            'doc' in first_cell or
            'material' in first_cell or
            'movement' in first_cell or
            'posting' in row_joined or
            'quantity' in row_joined
        )

        if not is_header:
            return False, None

        # Build column index mapping
        header_map: Dict[str, int] = {}
        for idx, cell in enumerate(first_row):
            norm = cell.strip().lower().replace('_', ' ').replace('-', ' ')
            norm_clean = re.sub(r'\s+', ' ', norm)

            if any(k in norm_clean for k in ['material doc', 'mat doc', 'doc num', 'document', 'mblnr', 'doc']) or 'doc' in norm_clean:
                if 'material_document' not in header_map:
                    header_map['material_document'] = idx
            elif any(k in norm_clean for k in ['posting date', 'post date', 'pstng', 'budat', 'date']):
                if 'posting_date' not in header_map:
                    header_map['posting_date'] = idx
            elif ('doc' not in norm_clean) and (any(k in norm_clean for k in ['movement type', 'mvt type', 'movement', 'bwart']) or norm_clean in ('mvt', 'bwart')):
                if 'movement_type' not in header_map:
                    header_map['movement_type'] = idx
            elif any(k in norm_clean for k in ['vendor', 'customer', 'partner', 'supplier', 'lifnr', 'kunnr']):
                if 'vendor_customer' not in header_map:
                    header_map['vendor_customer'] = idx
            elif ('doc' not in norm_clean and 'desc' not in norm_clean and 'partner' not in norm_clean) and (
                any(k in norm_clean for k in ['part number', 'part no', 'material no', 'matnr', 'material']) or
                re.search(r'\bpart\b', norm_clean)
            ):
                if 'part_number' not in header_map:
                    header_map['part_number'] = idx
            elif any(k in norm_clean for k in ['description', 'material desc', 'maktx', 'name', 'desc']):
                if 'material_description' not in header_map:
                    header_map['material_description'] = idx
            elif any(k in norm_clean for k in ['quantity', 'qty', 'menge', 'units']):
                if 'quantity' not in header_map:
                    header_map['quantity'] = idx
            elif any(k in norm_clean for k in ['uom', 'unit', 'meins']):
                if 'uom' not in header_map:
                    header_map['uom'] = idx
            elif any(k in norm_clean for k in ['sloc', 'storage loc', 'lgort', 'storage']):
                if 'storage_location' not in header_map:
                    header_map['storage_location'] = idx
            elif any(k in norm_clean for k in ['plant', 'werks']):
                if 'plant' not in header_map:
                    header_map['plant'] = idx
            elif any(k in norm_clean for k in ['purchase order', 'order', 'ebeln', 'aufnr']) or re.search(r'\bpo\b', norm_clean):
                if 'po_order_number' not in header_map:
                    header_map['po_order_number'] = idx

        return True, header_map

    @classmethod
    def _parse_single_row(
        cls,
        row: List[str],
        header_map: Optional[Dict[str, int]],
        row_index: int
    ) -> Tuple[Dict[str, Any], Optional[str]]:
        """
        Parses a single row using either the header map or positional fallback.
        """
        def get_val(key: str, default_pos: int, fallback: str = '') -> str:
            if header_map is not None:
                if key in header_map:
                    idx = header_map[key]
                    if idx < len(row):
                        return row[idx].strip()
                return fallback
            if default_pos < len(row):
                return row[default_pos].strip()
            return fallback

        # Extract values
        mat_doc = get_val('material_document', 0)
        date_str = get_val('posting_date', 1)
        mvt = get_val('movement_type', 2, '101')
        part_no = get_val('part_number', 3)
        desc = get_val('material_description', 4)
        qty_str = get_val('quantity', 5, '0')
        uom = get_val('uom', 6, 'PC') or 'PC'
        sloc = get_val('storage_location', 7, 'SL01') or 'SL01'
        partner = get_val('vendor_customer', 8, '')
        plant = get_val('plant', 9, '1001') or '1001'
        po_num = get_val('po_order_number', 10, '')

        extracted = {
            "row_index": row_index,
            "material_document": mat_doc,
            "posting_date": date_str,
            "movement_type": mvt,
            "part_number": part_no,
            "material_description": desc,
            "quantity": Decimal(0),
            "uom": uom,
            "storage_location": sloc,
            "plant": plant,
            "vendor_customer": partner,
            "po_order_number": po_num,
        }

        # Validations
        if not mat_doc:
            return extracted, f"Row {row_index}: Material Document is required."

        if not part_no:
            return extracted, f"Row {row_index}: Part Number is required."

        # Validate date
        parsed_date = WeekMappingService.parse_date(date_str)
        if not parsed_date:
            return extracted, f"Row {row_index}: Invalid posting date '{date_str}'. Expected date in YYYY-MM-DD, DD-MM-YYYY, or DD/MM/YYYY format."
        extracted["posting_date"] = parsed_date

        # Validate quantity
        clean_qty = qty_str.replace(',', '').replace(' ', '')
        try:
            qty_dec = Decimal(clean_qty)
            if qty_dec <= 0:
                return extracted, f"Row {row_index}: Quantity must be greater than 0 (got '{qty_str}')."
            extracted["quantity"] = qty_dec
        except (InvalidOperation, ValueError):
            return extracted, f"Row {row_index}: Invalid quantity value '{qty_str}'."

        # Normalize movement type
        clean_mvt = re.sub(r'\D', '', mvt)
        extracted["movement_type"] = clean_mvt or mvt

        # Default description if blank
        if not desc:
            extracted["material_description"] = f"Part {part_no}"

        return extracted, None
