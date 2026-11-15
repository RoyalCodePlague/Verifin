from io import BytesIO

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase
from PIL import Image

from inventory.purchasing_serializers import GoodsReceivedNoteAttachmentSerializer


class GoodsReceivedDocumentUploadTests(SimpleTestCase):
    def test_extension_cannot_disguise_another_file_type(self):
        upload = SimpleUploadedFile("invoice.jpg", b"%PDF-1.4 not an image", content_type="image/jpeg")
        serializer = GoodsReceivedNoteAttachmentSerializer(data={"file": upload})

        self.assertFalse(serializer.is_valid())
        self.assertIn("file", serializer.errors)

    def test_pdf_and_image_uploads_enforce_size_limits(self):
        oversized = SimpleUploadedFile("invoice.pdf", b"%PDF-" + b"x" * (10 * 1024 * 1024), content_type="application/pdf")
        serializer = GoodsReceivedNoteAttachmentSerializer(data={"file": oversized})
        self.assertFalse(serializer.is_valid())

        image_content = BytesIO()
        Image.new("RGB", (2, 2), "white").save(image_content, format="PNG")
        image = SimpleUploadedFile("proof.png", image_content.getvalue(), content_type="image/png")
        valid = GoodsReceivedNoteAttachmentSerializer(data={"file": image})
        self.assertTrue(valid.is_valid(), valid.errors)
