"""Crea (o reutiliza) el SERVIDOR DE VIDEO del directo en AWS EC2.

Todo etiquetado `Project=olo-ia-directo`, aislado de lo demas de la cuenta:
  · grupo de seguridad  olo-ia-directo-sg   (1935 RTMP, 8554 RTSP, 80/443 HTTPS, 8189 WebRTC)
  · rol IAM             olo-ia-directo-ssm  (administrarlo por SSM, sin llaves SSH)
  · IP fija (Elastic IP)                    -> la URL del dron no cambia nunca
  · instancia t4g.micro Ubuntu 24.04 ARM    con `servidor_video.sh.tmpl` como user-data

Credenciales de AWS: `clave_acceso` / `clave_secreta` de C:\\OLO_IA\\.env.local.
Contraseñas del servidor: C:\\OLO_IA\\.secrets\\media_server.json (fuera de git); aqui se
le añaden `host`, `ip` e `instance_id`.

Uso:  python backend/tools/nube/crear_servidor_video.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[3]
AWS = r"C:\Program Files\Amazon\AWSCLIV2\aws.exe"
REGION = "us-east-2"
NOMBRE = "olo-ia-directo"
TIPO = "t4g.micro"
AMI_FILTRO = "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-arm64-server-*"
BACKEND = "https://olo-ia-api.onrender.com"
SECRETOS = RAIZ / ".secrets" / "media_server.json"
TAGS = f"Key=Name,Value={NOMBRE}", f"Key=Project,Value={NOMBRE}"


def _env_aws() -> dict[str, str]:
    vals = {}
    for linea in (RAIZ / ".env.local").read_text(encoding="utf-8").splitlines():
        k, _, v = linea.partition("=")
        vals[k.strip()] = v.strip()
    return {
        **os.environ,
        "AWS_ACCESS_KEY_ID": vals["clave_acceso"],
        "AWS_SECRET_ACCESS_KEY": vals["clave_secreta"],
        "AWS_DEFAULT_REGION": REGION,
    }


ENV = _env_aws()


def aws(*args: str, ok_error: str | None = None) -> dict | str | None:
    r = subprocess.run([AWS, *args, "--output", "json"], capture_output=True, text=True, env=ENV)
    if r.returncode != 0:
        if ok_error and ok_error in r.stderr:
            return None
        sys.exit(f"ERROR aws {' '.join(args[:2])}: {r.stderr.strip()}")
    try:
        return json.loads(r.stdout) if r.stdout.strip() else None
    except json.JSONDecodeError:
        return r.stdout.strip()


def paso(t: str) -> None:
    print(f"\n>> {t}", flush=True)


def grupo_de_seguridad() -> str:
    paso("Grupo de seguridad")
    vpc = aws("ec2", "describe-vpcs", "--filters", "Name=isDefault,Values=true")["Vpcs"][0]["VpcId"]
    ya = aws("ec2", "describe-security-groups", "--filters",
             f"Name=group-name,Values={NOMBRE}-sg", f"Name=vpc-id,Values={vpc}")["SecurityGroups"]
    if ya:
        print(f"   reutilizo {ya[0]['GroupId']}")
        return ya[0]["GroupId"]
    sg = aws("ec2", "create-security-group", "--group-name", f"{NOMBRE}-sg", "--vpc-id", vpc,
             "--description", "OLO_IA directo del dron: RTMP, RTSP, HTTPS, WebRTC",
             "--tag-specifications",
             f"ResourceType=security-group,Tags=[{{{TAGS[0]}}},{{{TAGS[1]}}}]")["GroupId"]
    reglas = [("tcp", 1935, "RTMP dron"), ("tcp", 8554, "RTSP worker"), ("tcp", 80, "ACME"),
              ("tcp", 443, "HTTPS ver en vivo"), ("udp", 8189, "WebRTC"), ("tcp", 8189, "WebRTC TCP")]
    permisos = [{"IpProtocol": p, "FromPort": n, "ToPort": n,
                 "IpRanges": [{"CidrIp": "0.0.0.0/0", "Description": d}]} for p, n, d in reglas]
    aws("ec2", "authorize-security-group-ingress", "--group-id", sg,
        "--ip-permissions", json.dumps(permisos))
    print(f"   creado {sg}")
    return sg


def perfil_ssm() -> str:
    paso("Rol IAM para administrarlo por SSM (sin SSH)")
    rol = f"{NOMBRE}-ssm"
    confianza = json.dumps({"Version": "2012-10-17", "Statement": [{
        "Effect": "Allow", "Principal": {"Service": "ec2.amazonaws.com"},
        "Action": "sts:AssumeRole"}]})
    if aws("iam", "get-role", "--role-name", rol, ok_error="NoSuchEntity") is None:
        aws("iam", "create-role", "--role-name", rol, "--assume-role-policy-document", confianza,
            "--tags", *TAGS[1:])
        aws("iam", "attach-role-policy", "--role-name", rol, "--policy-arn",
            "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore")
        print("   rol creado")
    if aws("iam", "get-instance-profile", "--instance-profile-name", rol,
           ok_error="NoSuchEntity") is None:
        aws("iam", "create-instance-profile", "--instance-profile-name", rol)
        aws("iam", "add-role-to-instance-profile", "--instance-profile-name", rol,
            "--role-name", rol)
        print("   perfil creado (espero 15 s a que IAM lo propague)")
        time.sleep(15)
    return rol


def ip_fija() -> tuple[str, str]:
    paso("IP fija (Elastic IP)")
    ya = aws("ec2", "describe-addresses", "--filters", f"Name=tag:Project,Values={NOMBRE}")["Addresses"]
    if ya:
        print(f"   reutilizo {ya[0]['PublicIp']}")
        return ya[0]["AllocationId"], ya[0]["PublicIp"]
    r = aws("ec2", "allocate-address", "--domain", "vpc", "--tag-specifications",
            f"ResourceType=elastic-ip,Tags=[{{{TAGS[0]}}},{{{TAGS[1]}}}]")
    print(f"   asignada {r['PublicIp']}")
    return r["AllocationId"], r["PublicIp"]


def renderizar(secretos: dict, host: str, ip: str) -> str:
    """La plantilla con los secretos puestos. Solo en memoria / archivo temporal."""
    plantilla = (Path(__file__).parent / "servidor_video.sh.tmpl").read_text(encoding="utf-8")
    reemplazos = {
        "__HOST__": host, "__IP__": ip, "__BACKEND__": BACKEND,
        "__PATH__": secretos["media_path"],
        "__PUBLISH_USER__": secretos["publish_user"], "__PUBLISH_PASS__": secretos["publish_pass"],
        "__READ_USER__": secretos["read_user"], "__READ_PASS__": secretos["read_pass"],
        "__VIEW_USER__": secretos["view_user"], "__VIEW_PASS__": secretos["view_pass"],
        "__API_USER__": secretos["api_user"], "__API_PASS__": secretos["api_pass"],
        "__HOOK_SECRET__": secretos["hook_secret"],
    }
    for k, v in reemplazos.items():
        plantilla = plantilla.replace(k, v)
    import re

    assert not re.search(r"__[A-Z_]+__", plantilla), "quedo un marcador sin rellenar"
    return plantilla


def actualizar() -> None:
    """Vuelve a aplicar la plantilla en el servidor que ya existe, por SSM (sin SSH).

    El script es idempotente: reinstala lo que falte y reescribe la configuracion;
    MediaMTX y Caddy se reinician para tomarla.
    """
    import base64

    secretos = json.loads(SECRETOS.read_text(encoding="utf-8"))
    guion = renderizar(secretos, secretos["host"], secretos["ip"])
    guion += "\nsystemctl restart mediamtx caddy\n"
    b64 = base64.b64encode(guion.encode("utf-8")).decode()
    paso(f"Actualizando {secretos['instance_id']} por SSM")
    r = aws("ssm", "send-command", "--instance-ids", secretos["instance_id"],
            "--document-name", "AWS-RunShellScript", "--comment", "olo-ia-directo actualizar",
            "--parameters", json.dumps({"commands": [
                f"echo {b64} | base64 -d > /root/olo_setup.sh",
                "bash /root/olo_setup.sh > /var/log/olo_setup.log 2>&1; echo salida=$?",
                "rm -f /root/olo_setup.sh",
                "systemctl is-active mediamtx caddy",
            ]}))
    cid = r["Command"]["CommandId"]
    for _ in range(60):
        time.sleep(5)
        inv = aws("ssm", "get-command-invocation", "--command-id", cid,
                  "--instance-id", secretos["instance_id"], ok_error="InvocationDoesNotExist")
        if inv and inv["Status"] not in ("Pending", "InProgress", "Delayed"):
            print(f"   {inv['Status']}")
            print(inv["StandardOutputContent"][-600:])
            print(inv["StandardErrorContent"][-600:])
            return
    print("   sin respuesta en 5 min")


def main() -> None:
    secretos = json.loads(SECRETOS.read_text(encoding="utf-8"))
    vivas = aws("ec2", "describe-instances", "--filters", f"Name=tag:Project,Values={NOMBRE}",
                "Name=instance-state-name,Values=pending,running,stopped")["Reservations"]
    if vivas:
        sys.exit(f"Ya existe la instancia {vivas[0]['Instances'][0]['InstanceId']}: no creo otra.")

    sg = grupo_de_seguridad()
    perfil = perfil_ssm()
    asignacion, ip = ip_fija()
    host = ip.replace(".", "-") + ".sslip.io"

    paso("User-data")
    plantilla = renderizar(secretos, host, ip)
    datos = Path(os.environ.get("TEMP", ".")) / "olo_user_data.sh"
    datos.write_text(plantilla, encoding="utf-8", newline="\n")

    paso("Instancia")
    ami = aws("ec2", "describe-images", "--owners", "099720109477", "--filters",
              f"Name=name,Values={AMI_FILTRO}", "Name=state,Values=available",
              "--query", "sort_by(Images,&CreationDate)[-1].ImageId")
    r = aws("ec2", "run-instances", "--image-id", ami, "--instance-type", TIPO,
            "--security-group-ids", sg, "--iam-instance-profile", f"Name={perfil}",
            "--user-data", f"fileb://{datos}",
            "--metadata-options", "HttpTokens=required,HttpEndpoint=enabled",
            "--block-device-mappings",
            '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":16,"VolumeType":"gp3"}}]',
            "--tag-specifications",
            f"ResourceType=instance,Tags=[{{{TAGS[0]}}},{{{TAGS[1]}}}]",
            f"ResourceType=volume,Tags=[{{{TAGS[0]}}},{{{TAGS[1]}}}]")
    datos.unlink(missing_ok=True)  # llevaba contraseñas
    iid = r["Instances"][0]["InstanceId"]
    print(f"   {iid} ({TIPO}, {ami}); esperando a que arranque…")
    subprocess.run([AWS, "ec2", "wait", "instance-running", "--instance-ids", iid], env=ENV, check=True)
    aws("ec2", "associate-address", "--instance-id", iid, "--allocation-id", asignacion)

    secretos.update(host=host, ip=ip, instance_id=iid, region=REGION)
    SECRETOS.write_text(json.dumps(secretos, indent=1), encoding="utf-8")
    print(f"\nLISTO: {iid} en {ip} -> https://{host}  (el software tarda ~2-3 min en instalarse)")


if __name__ == "__main__":
    actualizar() if "--actualizar" in sys.argv else main()
