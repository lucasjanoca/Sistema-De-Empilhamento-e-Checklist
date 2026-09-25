from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Login(Input):
    matricula: str = Field(min_length=1, max_length=80)
    senha: str = Field(min_length=1, max_length=128)


class Password(Input):
    senha: str = Field(min_length=1, max_length=128)


class UserCreate(Login):
    nome: str = Field(min_length=1, max_length=160)
    role: Literal["empilhador", "encarregado", "ti"]


class UserUpdate(Input):
    action: Literal["password", "role", "active"]
    senha: str | None = Field(default=None, max_length=128)
    role: Literal["empilhador", "encarregado", "ti"] | None = None
    active: bool | None = None


class DeviceCreate(Input):
    name: str = Field(min_length=1, max_length=100)
    type: Literal["TABLET", "COMPUTADOR", "TOTEM"]


class DeviceSelect(Input):
    device_id: int = Field(gt=0)


class PalletCreate(Input):
    address: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9][A-Za-z0-9 ._/-]*$")
    operator: str = Field(min_length=1, max_length=160)
    quantity: int = Field(default=1, gt=0, le=1000)
    reference: str = Field(default="", max_length=100)
    volumes: int | None = Field(default=None, ge=0, le=1000000)
    note: str = Field(default="", max_length=1000)
    area: Literal["NORMAL", "EXP-PIC"] = "NORMAL"
    identified: bool = False
    stretch: bool = False


class Command(Input):
    version: int = Field(gt=0)
    reason: str = Field(default="", max_length=500)
    target_user_id: int | None = Field(default=None, gt=0)
    target_state: str | None = Field(default=None, max_length=30)


class LocationCommand(Input):
    address: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9][A-Za-z0-9 ._/-]*$")
    reason: str = Field(min_length=3, max_length=500)


class Redeem(Input):
    code: str = Field(pattern=r"^\d{6}$")


class EquipmentCreate(Input):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=100)
    type: Literal["bateria", "empilhadeira", "tablet"]


class EquipmentUpdate(EquipmentCreate):
    version: int = Field(gt=0)
    active: bool


class TemplateCreate(Input):
    type: Literal["bateria", "empilhadeira", "tablet"]
    name: str = Field(min_length=1, max_length=100)
    questions: list[str] = Field(min_length=1, max_length=100)
    expected_version: int = Field(default=0, ge=0)

    @field_validator("questions")
    @classmethod
    def valid_questions(cls, values):
        if any(not x.strip() or len(x) > 500 for x in values) or len(set(values)) != len(values):
            raise ValueError("Perguntas inválidas ou repetidas.")
        return values


class ChecklistCreate(Input):
    equipment_id: int = Field(gt=0)
    equipment_version: int = Field(gt=0)
    template_version_id: int = Field(gt=0)
    answers: list[Literal["ok", "warn", "crit"]] = Field(min_length=1, max_length=100)
    observation: str = Field(default="", max_length=1000)
    water: Literal["Cheio", "Abastecer", "Vazio"] | None = None
    liters: float | None = Field(default=None, ge=0, le=100000, allow_inf_nan=False)


class IssueUpdate(Input):
    version: int = Field(gt=0)
    status: Literal["IN_PROGRESS", "RESOLVED"]
    reason: str = Field(min_length=3, max_length=1000)


class BatterySwap(Input):
    removed_id: int | None = Field(default=None, gt=0)
    installed_id: int = Field(gt=0)
    forklift_id: int = Field(gt=0)
    out_meter: float = Field(ge=0, le=1000000000, allow_inf_nan=False)
    in_meter: float = Field(ge=0, le=1000000000, allow_inf_nan=False)
    observation: str = Field(default="", max_length=1000)


class RoleUpdate(Input):
    permissions: list[str] = Field(max_length=100)


class SettingsUpdate(Input):
    value: dict | list | str


class IntegrationConfig(Input):
    serverBase: str = Field(default="", max_length=300)
    routePending: str = Field(default="", max_length=240)
    routeAttendance: str = Field(default="", max_length=240)
    codGrupo: str = Field(default="", max_length=60)
    codEmp: str = Field(default="", max_length=60)
    enabled: bool = False
    interval: int = Field(default=10000, ge=5000, le=300000)
