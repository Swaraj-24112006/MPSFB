import pytest
from rest_framework import status

from core.models import RMPMComponentMaster, BOMFGHeader, BOMMaster


@pytest.mark.django_db
class TestGroup2Component:
    """
    GROUP 2 — RM/PM Component Master (/api/components/)
    Tests 2.1 to 2.10 covering CRUD, validations, filtering, search, and delete protection.
    """

    def test_2_1_create_valid_rm_component(self, api_client):
        """
        TEST 2.1 — Create a valid RM component
        Send POST with valid non-7 code, category=RM, safety_stock=500.
        Verify 201 Created, defaults (is_common_part=False, shared_in_fgs_count=0, is_active=True).
        """
        payload = {
            "component_code": "100201",
            "component_description": "Die-Cast Aluminum Housing",
            "category": "RM",
            "uom": "PC",
            "safety_stock": 500,
            "is_critical": True,
        }
        response = api_client.post("/api/components/", data=payload, format="json")
        assert response.status_code == status.HTTP_201_CREATED
        data = response.json()

        assert data["component_code"] == "100201"
        assert data["component_description"] == "Die-Cast Aluminum Housing"
        assert data["category"] == "RM"
        assert data["uom"] == "PC"
        assert float(data["safety_stock"]) == 500.0
        assert data["is_critical"] is True
        assert data["is_common_part"] is False
        assert data["shared_in_fgs_count"] == 0
        assert data["is_active"] is True

    def test_2_2_reject_component_code_starting_with_7(self, api_client):
        """
        TEST 2.2 — Reject component code starting with 7
        Send POST with component_code starting with 7.
        Verify 400 Bad Request, error references '7' restriction, no record in DB.
        """
        payload = {
            "component_code": "7001001",
            "component_description": "Invalid Code Component",
            "category": "RM",
            "uom": "PC",
        }
        response = api_client.post("/api/components/", data=payload, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        data = response.json()
        assert "component_code" in data
        assert "7" in str(data["component_code"])
        assert not RMPMComponentMaster.objects.filter(component_code="7001001").exists()

    def test_2_3_reject_duplicate_component_code(self, api_client):
        """
        TEST 2.3 — Reject duplicate component code
        Attempt to create duplicate component code.
        Verify 400 Bad Request or 409 Conflict, exactly 1 row persists in DB.
        """
        RMPMComponentMaster.objects.create(
            component_code="100201",
            component_description="First Housing",
            category="RM",
            uom="PC",
        )
        payload = {
            "component_code": "100201",
            "component_description": "Duplicate Housing",
            "category": "RM",
            "uom": "PC",
        }
        response = api_client.post("/api/components/", data=payload, format="json")
        assert response.status_code in (status.HTTP_400_BAD_REQUEST, status.HTTP_409_CONFLICT)
        assert RMPMComponentMaster.objects.filter(component_code="100201").count() == 1

    def test_2_4_list_components_with_paginate_false_for_dropdown(self, api_client):
        """
        TEST 2.4 — List components with paginate=false for dropdown
        Create 4 components in DB. Send GET ?paginate=false.
        Verify 200 OK, flat JSON array of 4 items.
        """
        for i in range(4):
            RMPMComponentMaster.objects.create(
                component_code=f"COMP_{i}",
                component_description=f"Component {i}",
                category="RM",
                uom="PC",
            )
        response = api_client.get("/api/components/?paginate=false")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 4

    def test_2_5_filter_components_by_category_pm(self, api_client):
        """
        TEST 2.5 — Filter components by category=PM
        Create one RM and one PM component. Send GET ?category=PM.
        Verify response contains only the PM component.
        """
        RMPMComponentMaster.objects.create(
            component_code="RM_PART_01",
            component_description="Steel Bar",
            category="RM",
            uom="KG",
        )
        RMPMComponentMaster.objects.create(
            component_code="PM_PART_01",
            component_description="Carton Box",
            category="PM",
            uom="PC",
        )
        response = api_client.get("/api/components/?category=PM")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        results = data["results"] if isinstance(data, dict) and "results" in data else data
        assert len(results) == 1
        assert results[0]["component_code"] == "PM_PART_01"
        assert results[0]["category"] == "PM"

    def test_2_6_filter_components_by_is_common_part_true(self, api_client):
        """
        TEST 2.6 — Filter components by is_common_part=true
        Create one common part and one non-common part. Send GET ?is_common_part=true.
        Verify only the common part appears.
        """
        RMPMComponentMaster.objects.create(
            component_code="NOT_COMMON",
            component_description="Unique Part",
            category="RM",
            is_common_part=False,
            uom="PC",
        )
        RMPMComponentMaster.objects.create(
            component_code="IS_COMMON",
            component_description="Shared Part",
            category="RM",
            is_common_part=True,
            uom="PC",
        )
        response = api_client.get("/api/components/?is_common_part=true")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        results = data["results"] if isinstance(data, dict) and "results" in data else data
        assert len(results) == 1
        assert results[0]["component_code"] == "IS_COMMON"
        assert results[0]["is_common_part"] is True

    def test_2_7_search_components_by_code_and_description(self, api_client):
        """
        TEST 2.7 — Search components by code and description
        Verify ?search=Aluminum and ?search=100201 match only the corresponding component.
        """
        RMPMComponentMaster.objects.create(
            component_code="100201",
            component_description="Die-Cast Aluminum Housing",
            category="RM",
            uom="PC",
        )
        RMPMComponentMaster.objects.create(
            component_code="200405",
            component_description="Carbon Vane",
            category="RM",
            uom="PC",
        )

        res_desc = api_client.get("/api/components/?search=Aluminum")
        assert res_desc.status_code == status.HTTP_200_OK
        data_desc = res_desc.json()
        results_desc = data_desc["results"] if isinstance(data_desc, dict) and "results" in data_desc else data_desc
        assert len(results_desc) == 1
        assert results_desc[0]["component_code"] == "100201"

        res_code = api_client.get("/api/components/?search=100201")
        assert res_code.status_code == status.HTTP_200_OK
        data_code = res_code.json()
        results_code = data_code["results"] if isinstance(data_code, dict) and "results" in data_code else data_code
        assert len(results_code) == 1
        assert results_code[0]["component_code"] == "100201"

    def test_2_8_update_component_description_and_safety_stock(self, api_client):
        """
        TEST 2.8 — Update component description and safety stock
        Send PATCH with updated description and safety stock.
        Verify response is 200 OK, updated fields present, component_code unchanged.
        """
        RMPMComponentMaster.objects.create(
            component_code="100201",
            component_description="Original Housing",
            category="RM",
            safety_stock=500.0,
            uom="PC",
        )
        payload = {
            "component_description": "Updated Housing",
            "safety_stock": 750,
        }
        response = api_client.patch("/api/components/100201/", data=payload, format="json")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["component_code"] == "100201"
        assert data["component_description"] == "Updated Housing"
        assert float(data["safety_stock"]) == 750.0

    def test_2_9_delete_component_when_no_bom_lines_reference_it(self, api_client):
        """
        TEST 2.9 — Delete component when no BOM lines reference it
        Send DELETE /api/components/{component_code}/.
        Verify 200 OK or 204 No Content, record removed from DB.
        """
        RMPMComponentMaster.objects.create(
            component_code="100201",
            component_description="Disposable Component",
            category="RM",
            uom="PC",
        )
        response = api_client.delete("/api/components/100201/")
        assert response.status_code in (status.HTTP_200_OK, status.HTTP_204_NO_CONTENT)
        assert not RMPMComponentMaster.objects.filter(component_code="100201").exists()

    def test_2_10_block_delete_of_component_that_is_referenced_by_bom_master(self, api_client):
        """
        TEST 2.10 — Block delete of component that is referenced by bom_master
        Create component, FG header, and BOM line linking them.
        Send DELETE on component. Verify 409 Conflict, component still exists, error mentions BOM.
        """
        comp = RMPMComponentMaster.objects.create(
            component_code="100201",
            component_description="Die-Cast Aluminum Housing",
            category="RM",
            uom="PC",
        )
        fg = BOMFGHeader.objects.create(
            fg_code="7.TEST.01.0",
            fg_description="Test Pump",
            uom="PC",
        )
        BOMMaster.objects.create(
            fg=fg,
            component=comp,
            qty=1.0,
            uom="PC",
        )

        response = api_client.delete("/api/components/100201/")
        assert response.status_code == status.HTTP_409_CONFLICT
        assert RMPMComponentMaster.objects.filter(component_code="100201").exists()
        data = response.json()
        assert "error" in data
        assert "bom" in data["error"].lower()
