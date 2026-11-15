from datetime import date
from decimal import Decimal
from io import BytesIO
from zipfile import ZipFile

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from inventory.models import Branch
from sales.models import Sale


class CustomReportTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        from billing.services import sync_plan_catalog

        sync_plan_catalog(force=True)

    def setUp(self):
        self.user = get_user_model().objects.create_user(username="report-owner", email="reports@example.com")
        self.activate_plan("business")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def activate_plan(self, code):
        from billing.models import Plan
        from billing.services import get_or_create_subscription

        subscription = get_or_create_subscription(self.user)
        subscription.plan = Plan.objects.get(code=code)
        subscription.status = "active"
        subscription.save()

    def test_templates_are_persisted_and_scoped_to_the_owner(self):
        branch = Branch.objects.create(user=self.user, name="Central")
        response = self.client.post(
            "/api/v1/reports/custom-reports/",
            {
                "name": "  Monthly sales  ",
                "metric": "sales",
                "group_by": "month",
                "start_date": "2026-01-01",
                "end_date": "2026-06-30",
                "branch_filter": "branch",
                "branch": branch.id,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["name"], "Monthly sales")
        template_id = response.data["id"]
        response = self.client.get("/api/v1/reports/custom-reports/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["results"][0]["id"], template_id)

    def test_invalid_date_ranges_and_foreign_branches_are_rejected(self):
        other_user = get_user_model().objects.create_user(username="other-report", email="other-reports@example.com")
        foreign_branch = Branch.objects.create(user=other_user, name="Other")
        response = self.client.post(
            "/api/v1/reports/custom-reports/",
            {
                "name": "Invalid",
                "metric": "sales",
                "group_by": "day",
                "start_date": date(2026, 6, 1).isoformat(),
                "end_date": date(2026, 5, 1).isoformat(),
                "branch_filter": "branch",
                "branch": foreign_branch.id,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)

    def test_custom_reports_require_an_enabled_plan_feature(self):
        self.activate_plan("starter")
        response = self.client.get("/api/v1/reports/custom-reports/")

        self.assertEqual(response.status_code, 403, response.data)

    def test_server_run_and_csv_excel_pdf_exports_use_saved_report_configuration(self):
        branch = Branch.objects.create(user=self.user, name="Central")
        Sale.objects.create(
            created_by=self.user, branch=branch, total=Decimal("125.00"),
            gross_profit=Decimal("40.00"), date=date(2026, 6, 12),
        )
        Sale.objects.create(
            created_by=self.user, branch=branch, total=Decimal("75.00"),
            gross_profit=Decimal("20.00"), date=date(2026, 5, 12),
        )
        report = self.client.post("/api/v1/reports/custom-reports/", {
            "name": "June sales", "metric": "sales", "group_by": "month",
            "sort_order": "desc", "start_date": "2026-05-01", "end_date": "2026-06-30",
            "branch_filter": "branch", "branch": branch.id,
        }, format="json")
        self.assertEqual(report.status_code, 201, report.data)

        run = self.client.get(f"/api/v1/reports/custom-reports/{report.data['id']}/run/")
        self.assertEqual(run.status_code, 200, run.data)
        self.assertEqual(run.data["rows"], [
            {"period": "2026-06", "value": "125.00"},
            {"period": "2026-05", "value": "75.00"},
        ])

        csv_response = self.client.get(f"/api/v1/reports/custom-reports/{report.data['id']}/export/?export_format=csv")
        pdf_response = self.client.get(f"/api/v1/reports/custom-reports/{report.data['id']}/export/?export_format=pdf")
        xlsx_response = self.client.get(f"/api/v1/reports/custom-reports/{report.data['id']}/export/?export_format=xlsx")
        self.assertEqual(csv_response.status_code, 200, csv_response.content)
        self.assertIn("2026-06,125.00", csv_response.content.decode())
        self.assertIn("2026-05,75.00", csv_response.content.decode())
        self.assertEqual(pdf_response.status_code, 200)
        self.assertTrue(pdf_response.content.startswith(b"%PDF"))
        self.assertEqual(xlsx_response.status_code, 200)
        with ZipFile(BytesIO(xlsx_response.content)) as workbook:
            self.assertIn("xl/worksheets/sheet1.xml", workbook.namelist())

    def test_custom_report_can_select_multiple_fields_and_export_each_column(self):
        Sale.objects.create(
            created_by=self.user, total=Decimal("125.00"), gross_profit=Decimal("40.00"),
            date=date(2026, 6, 12),
        )
        Sale.objects.create(
            created_by=self.user, total=Decimal("75.00"), gross_profit=Decimal("20.00"),
            date=date(2026, 6, 20),
        )
        report = self.client.post("/api/v1/reports/custom-reports/", {
            "name": "June performance",
            "metrics": ["sales", "profit", "transactions"],
            "group_by": "month",
            "sort_order": "desc",
            "start_date": "2026-06-01",
            "end_date": "2026-06-30",
        }, format="json")
        self.assertEqual(report.status_code, 201, report.data)
        self.assertEqual(report.data["metric"], "sales")
        self.assertEqual(report.data["metrics"], ["sales", "profit", "transactions"])

        run = self.client.get(f"/api/v1/reports/custom-reports/{report.data['id']}/run/")
        self.assertEqual(run.status_code, 200, run.data)
        self.assertEqual(run.data["rows"], [{
            "period": "2026-06",
            "value": "200.00",
            "values": {"sales": "200.00", "profit": "60.00", "transactions": 2},
        }])

        csv_response = self.client.get(f"/api/v1/reports/custom-reports/{report.data['id']}/export/?export_format=csv")
        self.assertEqual(csv_response.status_code, 200)
        csv_lines = csv_response.content.decode().splitlines()
        self.assertEqual(csv_lines[0], "Period,Sales,Gross profit,Transactions")
        self.assertEqual(csv_lines[1], "2026-06,200.00,60.00,2")

        xlsx_response = self.client.get(f"/api/v1/reports/custom-reports/{report.data['id']}/export/?export_format=xlsx")
        self.assertEqual(xlsx_response.status_code, 200)
        with ZipFile(BytesIO(xlsx_response.content)) as workbook:
            sheet = workbook.read("xl/worksheets/sheet1.xml").decode()
            for value in ("Sales", "Gross profit", "Transactions", "200.00", "60.00", ">2<"):
                self.assertIn(value, sheet)

    def test_run_and_exports_cannot_access_another_business_template(self):
        report = self.client.post("/api/v1/reports/custom-reports/", {
            "name": "Private report", "metric": "transactions", "group_by": "day",
        }, format="json")
        other_user = get_user_model().objects.create_user(username="foreign-report", email="foreign-report@example.com")
        from billing.models import Plan
        from billing.services import get_or_create_subscription
        subscription = get_or_create_subscription(other_user)
        subscription.plan = Plan.objects.get(code="business")
        subscription.status = "active"
        subscription.save()
        other_client = APIClient()
        other_client.force_authenticate(other_user)
        response = other_client.get(f"/api/v1/reports/custom-reports/{report.data['id']}/export/?export_format=csv")
        self.assertEqual(response.status_code, 404)
