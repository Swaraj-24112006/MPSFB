from datetime import datetime
import pytest
from rest_framework import status

from core.models import BOMFGHeader, MonthlyPlan


@pytest.mark.django_db
class TestGroup1FGHeader:
    """
    GROUP 1 — FG Header (/api/bom/fg-headers/)
    Tests 1.1 to 1.11 covering CRUD, validations, pagination, search, warnings, and deletion rules.
    """

    def test_1_1_create_valid_fg_header(self, api_client):
        """
        TEST 1.1 — Create a valid FG Header
        Send a POST request to /api/bom/fg-headers/ with a valid payload where fg_code starts with 7.
        Verify 201 Created, exact field values, defaults (active_bom_version='v1', is_active=True),
        and non-null valid ISO 8601 created_at / updated_at timestamps.
        """
        payload = {
            "fg_code": "7.06496.03.0",
            "fg_description": "Vacuum Pump Panther 2.0L",
            "mini_factory": "Pumps_Division",
            "line": "A-PMP2",
            "unit_price_inr": 5800,
            "uom": "PC",
        }

        response = api_client.post("/api/bom/fg-headers/", data=payload, format="json")

        assert response.status_code == status.HTTP_201_CREATED
        data = response.json()

        assert data["fg_code"] == "7.06496.03.0"
        assert data["fg_description"] == "Vacuum Pump Panther 2.0L"
        assert data["mini_factory"] == "Pumps_Division"
        assert data["line"] == "A-PMP2"
        assert float(data["unit_price_inr"]) == 5800.0
        assert data["active_bom_version"] == "v1"
        assert data["uom"] == "PC"
        assert data["is_active"] is True

        assert data.get("created_at") is not None
        assert data.get("updated_at") is not None
        # Parse ISO 8601 timestamps to verify validity
        datetime.fromisoformat(data["created_at"].replace("Z", "+00:00"))
        datetime.fromisoformat(data["updated_at"].replace("Z", "+00:00"))

    def test_1_2_reject_fg_code_not_starting_with_7(self, api_client):
        """
        TEST 1.2 — Reject FG code that does not start with 7
        Send POST with code starting with non-7 digit or letter.
        Verify 400 Bad Request, validation message referencing '7', and no DB record created.
        """
        for invalid_code in ["1.06496.03.0", "A001"]:
            payload = {
                "fg_code": invalid_code,
                "fg_description": "Wrong Prefix FG",
                "uom": "PC",
            }
            response = api_client.post("/api/bom/fg-headers/", data=payload, format="json")
            assert response.status_code == status.HTTP_400_BAD_REQUEST

            data = response.json()
            assert "fg_code" in data
            error_msg = str(data["fg_code"])
            assert "7" in error_msg
            assert not BOMFGHeader.objects.filter(fg_code=invalid_code).exists()

    def test_1_3_reject_duplicate_fg_code(self, api_client):
        """
        TEST 1.3 — Reject duplicate FG code
        Verify duplicate POST returns 400 or 409 and only 1 record exists.
        """
        BOMFGHeader.objects.create(
            fg_code="7.TEST.01.0",
            fg_description="Original Test FG",
            uom="PC",
        )
        payload = {
            "fg_code": "7.TEST.01.0",
            "fg_description": "Duplicate FG",
            "uom": "PC",
        }
        response = api_client.post("/api/bom/fg-headers/", data=payload, format="json")
        assert response.status_code in (status.HTTP_400_BAD_REQUEST, status.HTTP_409_CONFLICT)
        assert BOMFGHeader.objects.filter(fg_code="7.TEST.01.0").count() == 1

    def test_1_4_list_fg_headers_with_pagination(self, api_client):
        """
        TEST 1.4 — List FG headers with pagination
        Create 5 FG headers and send GET ?page=1. Verify 200 OK, count=5, results list.
        """
        for i in range(5):
            BOMFGHeader.objects.create(
                fg_code=f"7.PAGE.{i}.0",
                fg_description=f"Pagination Test FG {i}",
                uom="PC",
            )
        response = api_client.get("/api/bom/fg-headers/?page=1")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert "count" in data
        assert "results" in data
        assert isinstance(data["results"], list)
        assert data["count"] == 5

    def test_1_5_list_fg_headers_with_paginate_false_returns_flat_list(self, api_client):
        """
        TEST 1.5 — List FG headers with paginate=false returns flat list
        Create 3 FG records and verify ?paginate=false returns a flat JSON array of length 3.
        """
        for i in range(3):
            BOMFGHeader.objects.create(
                fg_code=f"7.FLAT.{i}.0",
                fg_description=f"Flat List FG {i}",
                uom="PC",
            )
        response = api_client.get("/api/bom/fg-headers/?paginate=false")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 3

    def test_1_6_search_fg_headers_by_description(self, api_client):
        """
        TEST 1.6 — Search FG headers by description
        Verify ?search=Vacuum filters only matching records.
        """
        BOMFGHeader.objects.create(
            fg_code="7.PUMP.01.0",
            fg_description="Vacuum Pump Panther 2.0L",
            uom="PC",
        )
        BOMFGHeader.objects.create(
            fg_code="7.PUMP.02.0",
            fg_description="Oil Pump Gen 3",
            uom="PC",
        )
        response = api_client.get("/api/bom/fg-headers/?search=Vacuum")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        results = data["results"] if isinstance(data, dict) and "results" in data else data
        assert len(results) == 1
        assert results[0]["fg_code"] == "7.PUMP.01.0"
        assert "Vacuum" in results[0]["fg_description"]

    def test_1_7_filter_fg_headers_by_is_active_false(self, api_client):
        """
        TEST 1.7 — Filter FG headers by is_active=false
        Verify only inactive FG headers are returned.
        """
        BOMFGHeader.objects.create(
            fg_code="7.ACT.01.0",
            fg_description="Active FG",
            is_active=True,
            uom="PC",
        )
        BOMFGHeader.objects.create(
            fg_code="7.INACT.01.0",
            fg_description="Inactive FG",
            is_active=False,
            uom="PC",
        )
        response = api_client.get("/api/bom/fg-headers/?is_active=false")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        results = data["results"] if isinstance(data, dict) and "results" in data else data
        assert len(results) == 1
        assert results[0]["fg_code"] == "7.INACT.01.0"
        assert results[0]["is_active"] is False

    def test_1_8_update_fg_header_description_and_unit_price(self, api_client):
        """
        TEST 1.8 — Update FG header description and unit price
        Send PATCH with updated description and price. Verify updates and read-only fg_code.
        """
        BOMFGHeader.objects.create(
            fg_code="7.UPDATE.01.0",
            fg_description="Initial Description",
            unit_price_inr=5000.0,
            uom="PC",
        )
        payload = {
            "fg_description": "Updated Description",
            "unit_price_inr": 9999,
        }
        response = api_client.patch("/api/bom/fg-headers/7.UPDATE.01.0/", data=payload, format="json")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["fg_code"] == "7.UPDATE.01.0"
        assert data["fg_description"] == "Updated Description"
        assert float(data["unit_price_inr"]) == 9999.0

    def test_1_9_changing_active_bom_version_returns_warning(self, api_client):
        """
        TEST 1.9 — Changing active_bom_version returns a warning
        Verify PATCH with new active_bom_version returns a warning and updates version in DB.
        """
        fg = BOMFGHeader.objects.create(
            fg_code="7.VER.01.0",
            fg_description="Versioned FG",
            active_bom_version="v1",
            uom="PC",
        )
        payload = {"active_bom_version": "v2"}
        response = api_client.patch(f"/api/bom/fg-headers/{fg.fg_code}/", data=payload, format="json")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert "warning" in data
        assert "MRP" in data["warning"] or "BOM" in data["warning"]
        fg.refresh_from_db()
        assert fg.active_bom_version == "v2"

    def test_1_10_delete_fg_header_when_no_monthly_plans_exist(self, api_client):
        """
        TEST 1.10 — Delete FG header when no monthly plans exist
        Verify 200 OK or 204 No Content and record deleted from DB.
        """
        fg = BOMFGHeader.objects.create(
            fg_code="7.DEL.01.0",
            fg_description="Deletable FG",
            uom="PC",
        )
        response = api_client.delete(f"/api/bom/fg-headers/{fg.fg_code}/")
        assert response.status_code in (status.HTTP_200_OK, status.HTTP_204_NO_CONTENT)
        assert not BOMFGHeader.objects.filter(fg_code="7.DEL.01.0").exists()

    def test_1_11_block_delete_of_fg_header_when_active_monthly_plans_reference_it(self, api_client):
        """
        TEST 1.11 — Block delete of FG header when active monthly plans reference it
        Verify 409 Conflict, error message referencing active plans, and FG record retained in DB.
        """
        fg = BOMFGHeader.objects.create(
            fg_code="7.PLAN.01.0",
            fg_description="Planned FG",
            uom="PC",
        )
        MonthlyPlan.objects.create(
            fg=fg,
            month="2026-08",
            monthly_target=100,
        )
        response = api_client.delete(f"/api/bom/fg-headers/{fg.fg_code}/")
        assert response.status_code == status.HTTP_409_CONFLICT
        assert BOMFGHeader.objects.filter(fg_code="7.PLAN.01.0").exists()
        data = response.json()
        assert "error" in data
        assert "monthly plan" in data["error"].lower()
