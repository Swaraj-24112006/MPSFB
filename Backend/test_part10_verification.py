"""
Part 10 Integration Verification Test Suite
Tests all 9 points from Update_Delivery_Schedule_Implementation.md Part 10.
"""
import os
import sys
import io
import json
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mps_backend.settings')
django.setup()

from rest_framework.test import APIClient
from core.models import (
    VendorDeliverySchedule, DeliveryScheduleChangeLog,
    UploadBatch, WeekDefinition, BOMMaster
)


def run_tests():
    # Clean up any leftover test records from prior runs
    VendorDeliverySchedule.objects.filter(po_number__in=['PO-TEST-001', 'PO-BULK-001', 'PO-BULK-002']).delete()
    DeliveryScheduleChangeLog.objects.filter(po_number__in=['PO-TEST-001', 'PO-BULK-001', 'PO-BULK-002']).delete()

    client = APIClient()
    base = '/api/v1'
    passed = 0
    total = 9

    print("=" * 70)
    print("RUNNING PART 10 INTEGRATION VERIFICATION CHECKS")
    print("=" * 70)

    # ─────────────────────────────────────────────────────────────────────────
    # Check 1: Consolidated Matrix endpoint returns rows
    # ─────────────────────────────────────────────────────────────────────────
    print("\n--- Check 1: Consolidated Matrix endpoint ---")
    url = f"{base}/vendor-schedule/consolidated-matrix/?month=2026-08&scope_mode=WEEK&week_code=w-2026-08-02"
    res = client.get(url)
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.content}"
    data = res.json()
    rows = data.get('rows', [])
    summary = data.get('summary', {})
    print(f"  Rows count: {len(rows)}")
    print(f"  Summary: {summary}")
    req_keys = [
        'componentCode', 'category', 'weeklyGrossReq', 'weeklyInwardDeliveries',
        'hasShortage', 'selectedScopeDeficit', 'buyerName', 'vendorName'
    ]
    if rows:
        missing = [k for k in req_keys if k not in rows[0]]
        assert not missing, f"Missing keys in row: {missing}"
        print(f"  All required keys present in rows: {req_keys}")
    assert len(rows) > 0, "Expected at least 1 component row"
    passed += 1
    print("  [PASS] Check 1 PASSED")

    # ─────────────────────────────────────────────────────────────────────────
    # Check 2: Create a delivery schedule (requires reason >= 10 chars)
    # ─────────────────────────────────────────────────────────────────────────
    print("\n--- Check 2: Create a delivery schedule ---")
    url = f"{base}/vendor-delivery-schedules/"
    payload = {
        "po_number": "PO-TEST-001",
        "component_code": "100201",
        "vendor_code": "V-1020",
        "vendor_name": "CastAlu Technologies",
        "buyer_name": "Rajesh Kumar",
        "expected_delivery_date": "2026-08-10",
        "month": "2026-08",
        "promised_qty": 2000,
        "delivery_status": "CONFIRMED_ON_TRACK",
        "changed_by": "Test Planner",
        "reason_for_change": "New vendor commitment for week 2 shortfall",
    }
    res = client.post(url, data=payload, format='json')
    assert res.status_code == 201, f"Expected 201, got {res.status_code}: {res.content}"
    d = res.json()
    sched_id = d.get('id')
    week_id = d.get('weekId')
    print(f"  Created id: {sched_id}")
    print(f"  Resolved weekId: {week_id}")
    assert sched_id is not None, "id should not be None"
    assert week_id == "w-2026-08-02", f"Expected w-2026-08-02, got {week_id}"
    passed += 1
    print("  [PASS] Check 2 PASSED")

    # ─────────────────────────────────────────────────────────────────────────
    # Check 3: Verify reason_for_change < 10 chars is rejected (400)
    # ─────────────────────────────────────────────────────────────────────────
    print("\n--- Check 3: Short reason_for_change is rejected ---")
    short_payload = {
        "component_code": "100201",
        "promised_qty": 500,
        "expected_delivery_date": "2026-08-10",
        "changed_by": "Planner",
        "reason_for_change": "short"
    }
    res = client.post(url, data=short_payload, format='json')
    assert res.status_code == 400, f"Expected 400, got {res.status_code}: {res.content}"
    print(f"  Rejected with 400: {res.json()}")
    passed += 1
    print("  [PASS] Check 3 PASSED")

    # ─────────────────────────────────────────────────────────────────────────
    # Check 4: Edit schedule and verify per-field audit logs
    # ─────────────────────────────────────────────────────────────────────────
    print("\n--- Check 4: Edit schedule ---")
    detail_url = f"{base}/vendor-delivery-schedules/{sched_id}/"
    patch_payload = {
        "promised_qty": 3500,
        "expected_delivery_date": "2026-08-12",
        "changed_by": "Test Planner",
        "reason_for_change": "Vendor confirmed revised quantity and arrival date",
    }
    res = client.patch(detail_url, data=patch_payload, format='json')
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.content}"
    updated_d = res.json()
    print(f"  Updated promisedQty: {updated_d.get('promisedQty')}")
    print(f"  Updated weekId: {updated_d.get('weekId')}")
    assert float(updated_d.get('promisedQty')) == 3500.0, f"Expected 3500, got {updated_d.get('promisedQty')}"
    assert updated_d.get('weekId') == "w-2026-08-02"
    passed += 1
    print("  [PASS] Check 4 PASSED")

    # ─────────────────────────────────────────────────────────────────────────
    # Check 5: Verify change logs were written
    # ─────────────────────────────────────────────────────────────────────────
    print("\n--- Check 5: Verify audit change logs ---")
    logs_url = f"{base}/vendor-delivery-schedules/change-logs/?component_code=100201"
    res = client.get(logs_url)
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.content}"
    logs_data = res.json()
    logs = logs_data.get('results', [])
    print(f"  Audit logs for 100201: {len(logs)}")
    for log in logs[:5]:
        print(f"    {log.get('fieldChanged')} | {log.get('oldValue')} -> {log.get('newValue')}")
    assert len(logs) >= 3, f"Expected at least 3 logs, got {len(logs)}"
    passed += 1
    print("  [PASS] Check 5 PASSED")

    # ─────────────────────────────────────────────────────────────────────────
    # Check 6: Delete the schedule and verify deletion log
    # ─────────────────────────────────────────────────────────────────────────
    print("\n--- Check 6: Delete schedule and verify deletion log ---")
    del_payload = {
        "changed_by": "Test Planner",
        "reason_for_change": "Testing deletion audit trail",
    }
    res = client.delete(detail_url, data=del_payload, format='json')
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.content}"
    assert res.json().get('deleted') is True, f"Expected deleted: True, got {res.json()}"
    print(f"  Deleted response: {res.json()}")

    # Check deletion log
    res = client.get(logs_url)
    logs = res.json().get('results', [])
    deleted_log = next((l for l in logs if 'Deleted' in l.get('fieldChanged', '') or 'Cancelled' in l.get('fieldChanged', '')), None)
    assert deleted_log is not None, f"Deletion audit log not found among: {[l.get('fieldChanged') for l in logs]}"
    print(f"  Delete audit log found: {deleted_log.get('fieldChanged')}")
    passed += 1
    print("  [PASS] Check 6 PASSED")

    # ─────────────────────────────────────────────────────────────────────────
    # Check 7: Bulk upload test
    # ─────────────────────────────────────────────────────────────────────────
    print("\n--- Check 7: Bulk upload test ---")
    upload_url = f"{base}/uploads/vendor-delivery-schedules/"
    csv_content = (
        "PO_Number,Component_Code,Component_Description,Vendor_Code,Vendor_Name,Buyer_Name,Expected_Delivery_Date,Week_No,Promised_Quantity,Delivery_Status,Carrier_Or_Tracking,Notes\n"
        "PO-BULK-001,100201,Die-Cast Aluminum Housing,V-1001,CastAlu,Rajesh Kumar,2026-08-11,2,1500,CONFIRMED_ON_TRACK,Truck 1,Bulk test row 1\n"
        "PO-BULK-002,200405,Composite Carbon Vane,V-1002,CarbonTech,Ananya Sharma,2026-08-12,2,2500,CONFIRMED_ON_TRACK,Truck 2,Bulk test row 2\n"
    )
    csv_file = io.BytesIO(csv_content.encode('utf-8'))
    csv_file.name = 'test_schedule.csv'

    res = client.post(
        upload_url,
        data={
            'file': csv_file,
            'month': '2026-08',
            'changed_by': 'Test Planner',
            'import_mode': 'APPEND',
            'upload_scope': 'SELECTED_WEEK',
            'week_code': 'w-2026-08-02',
        },
        format='multipart'
    )
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.content}"
    upload_resp = res.json()
    print(f"  Upload response: {upload_resp}")
    assert upload_resp.get('imported_rows') == 2, f"Expected 2 imported rows, got {upload_resp.get('imported_rows')}"
    assert upload_resp.get('error_rows') == 0, f"Expected 0 error rows, got {upload_resp.get('error_rows')}"
    passed += 1
    print("  [PASS] Check 7 PASSED")

    # ─────────────────────────────────────────────────────────────────────────
    # Check 8: Auto-fill deficits
    # ─────────────────────────────────────────────────────────────────────────
    print("\n--- Check 8: Auto-fill deficits ---")
    autofill_url = f"{base}/vendor-delivery-schedules/auto-fill-deficits/"
    res = client.post(
        autofill_url,
        data={
            'month': '2026-08',
            'scope_mode': 'WEEK',
            'week_code': 'w-2026-08-02',
            'changed_by': 'Test Planner',
        },
        format='json'
    )
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.content}"
    af_data = res.json()
    print(f"  Auto-fill response: {af_data}")
    assert 'generated' in af_data, "generated key should be in response"
    assert 'total_units_committed' in af_data, "total_units_committed key should be in response"
    print(f"  Generated commitments: {af_data.get('generated')}, Total units: {af_data.get('total_units_committed')}")
    passed += 1
    print("  [PASS] Check 8 PASSED")

    # ─────────────────────────────────────────────────────────────────────────
    # Check 9: Template downloads
    # ─────────────────────────────────────────────────────────────────────────
    print("\n--- Check 9: Template downloads ---")
    blank_url = f"{base}/exports/vendor-schedule-blank-template/?month=2026-08&week_no=2&week_start=2026-08-08"
    res = client.get(blank_url)
    assert res.status_code == 200, f"Blank template download failed with {res.status_code}"
    blank_bytes = b"".join(res.streaming_content) if hasattr(res, 'streaming_content') else res.content
    print(f"  Blank template size: {len(blank_bytes)} bytes")
    assert len(blank_bytes) > 2000, f"Expected file > 2KB, got {len(blank_bytes)}"

    prefilled_url = f"{base}/exports/vendor-schedule-prefilled/?month=2026-08&scope_mode=WEEK&week_code=w-2026-08-02"
    res = client.get(prefilled_url)
    assert res.status_code == 200, f"Prefilled template download failed with {res.status_code}"
    prefilled_bytes = b"".join(res.streaming_content) if hasattr(res, 'streaming_content') else res.content
    print(f"  Prefilled template size: {len(prefilled_bytes)} bytes")
    assert len(prefilled_bytes) > 2000, f"Expected file > 2KB, got {len(prefilled_bytes)}"

    matrix_url = f"{base}/exports/vendor-schedule-matrix/?month=2026-08"
    res = client.get(matrix_url)
    assert res.status_code == 200, f"Matrix report download failed with {res.status_code}"
    matrix_bytes = b"".join(res.streaming_content) if hasattr(res, 'streaming_content') else res.content
    print(f"  Matrix report size: {len(matrix_bytes)} bytes")
    assert len(matrix_bytes) > 2000, f"Expected file > 2KB, got {len(matrix_bytes)}"

    passed += 1
    print("  [PASS] Check 9 PASSED")

    print("\n" + "=" * 70)
    print(f"ALL {passed}/{total} INTEGRATION VERIFICATION CHECKS PASSED SUCCESSFULLY!")
    print("=" * 70)


if __name__ == '__main__':
    run_tests()
