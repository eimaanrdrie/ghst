from io import BytesIO

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject


def _policy_pdf() -> bytes:
    stream = BytesIO()
    writer = PdfWriter()
    font = DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/Helvetica"),
    })
    for page_text in (
        "POLICY MEMORY PILOT\n1.1 Public legal research for internal governance is blocked before external release.\n1.2 Other general drafting may be reviewed by the policy administrator.",
        "2.1 Clause review and activation require explicit policy administrator verification.\n2.2 Multi-page policies preserve page citations in GHST.",
    ):
        page = writer.add_blank_page(width=612, height=792)
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})})
        content = DecodedStreamObject()
        text = "BT /F1 12 Tf 72 720 Td " + " Tj T* ".join(f"({line})" for line in page_text.split("\n")) + " ET"
        content.set_data(text.encode("utf-8"))
        page[NameObject("/Contents")] = writer._add_object(content)
    writer.write(stream)
    return stream.getvalue()


def test_policy_memory_end_to_end_blocks_employee_request(client, policy_headers, legal_headers):
    upload = client.post(
        "/api/v1/policies/uploads",
        headers=policy_headers,
        files={"file": ("policy-memory.pdf", _policy_pdf(), "application/pdf")},
        data={
            "name": "Policy Memory Pilot",
            "version": "PM-1.0",
            "category": "DATA_HANDLING",
            "owner": "Policy Administrator",
            "scope": "ORGANISATION",
            "description": "End-to-end policy memory acceptance fixture.",
        },
    )
    assert upload.status_code == 200, upload.text
    body = upload.json()
    assert body["clause_count"] >= 2

    policy = client.get(f"/api/v1/policies/{body['policy_id']}", headers=policy_headers).json()
    version = policy["versions"][0]
    assert version["status"] == "HUMAN_REVIEW"
    assert len(version["clauses"]) >= 2

    for index, clause in enumerate(version["clauses"]):
        updated = client.patch(
            f"/api/v1/policies/clauses/{clause['id']}",
            headers=policy_headers,
            json={
                "clause_ref": clause["clause_ref"],
                "text": clause["text"],
                "department": clause["department"],
                "roles": clause["roles"],
                "purposes": clause["purposes"] or ["Legal research"],
                "data_classes": clause["data_classes"],
                "destinations": clause["destinations"] or ["http://localhost:3000/ai-sandbox"],
                "action": "BLOCK" if index == 0 else "ALLOW",
                "page_number": clause["page_number"],
                "heading": clause["heading"],
                "verification_status": "VERIFIED",
                "human_notes": "Verified for policy memory acceptance.",
            },
        )
        assert updated.status_code == 200, updated.text

    activated = client.post(f"/api/v1/policies/versions/{body['version_id']}/activate", headers=policy_headers)
    assert activated.status_code == 200, activated.text
    assert activated.json()["status"] == "ACTIVE"

    evaluation = client.post(
        "/api/v1/evaluations",
        headers=legal_headers,
        data={
            "prompt": "Summarise the public memo for internal training.",
            "purpose": "Legal research",
            "destination_origin": "http://localhost:3000/ai-sandbox",
            "session_id": "policy-memory-acceptance",
            "device_id": "test-device",
        },
    )
    assert evaluation.status_code == 200, evaluation.text
    result = evaluation.json()
    assert result["action"] == "BLOCK"
    assert result["policy_matches"]
    citation = result["policy_matches"][0]
    assert citation["page"] == 1
    assert "Policy Memory Pilot" in citation["citation"]
    assert "§" in citation["citation"]
