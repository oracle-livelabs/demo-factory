#!/bin/bash

#######    S T A R T      S C R I P T    ######
#######   (this is for Oracle Linux 9)   ######

INSTALL_LOG="/home/opc/inst.log"
TOTAL_STEPS=12
CURRENT_STEP=0
CURRENT_LABEL="Starting installation"
BUILD_ARCHIVE_URL="${BUILD_ARCHIVE_URL:-}"

oci_metadata_value() {
  local key="$1"
  local value

  value="$(curl -fsS --max-time 3 -H "Authorization: Bearer Oracle" -L "http://169.254.169.254/opc/v2/instance/metadata/${key}" 2>/dev/null || true)"
  if [[ -z "${value}" || ${value} =~ '<html>' ]]; then
    return 1
  fi

  printf '%s' "${value}"
}

progress() {
  CURRENT_STEP="$1"
  CURRENT_LABEL="$2"
  local percent=$((CURRENT_STEP * 100 / TOTAL_STEPS)) width=40 filled empty complete pending
  filled=$((CURRENT_STEP * width / TOTAL_STEPS))
  empty=$((width - filled))
  printf -v complete '%*s' "${filled}" ''
  printf -v pending '%*s' "${empty}" ''
  complete=${complete// /#}
  pending=${pending// /-}
  printf '\r[%s%s] %3d%%  %s' "${complete}" "${pending}" "${percent}" "${CURRENT_LABEL}" >&3
}

on_error() {
  local status=$?
  printf '\nInstallation failed during: %s\nDetailed output: %s\n' "${CURRENT_LABEL}" "${INSTALL_LOG}" >&3
  exit "${status}"
}

ENV_FILE="/home/opc/.env"
if [[ -r "${ENV_FILE}" ]]; then
  source "${ENV_FILE}"
  if ! chmod 600 "${ENV_FILE}"; then
    printf 'Unable to restrict %s to owner-only permissions.\n' "${ENV_FILE}" >&2
    exit 1
  fi
fi

is_enabled() {
  case "${1,,}" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

if [[ -z "${BUILD_ARCHIVE_URL:-}" ]]; then
  BUILD_ARCHIVE_URL="$(oci_metadata_value build_archive_url || true)"
fi
if [[ -z "${BUILD_ARCHIVE_URL:-}" ]]; then
  printf 'BUILD_ARCHIVE_URL is required in %s or OCI metadata key build_archive_url.\n' "${ENV_FILE}" >&2
  exit 1
fi
export BUILD_ARCHIVE_URL

if [[ -z "${GGSA_OSA_ARCHIVE_URL:-}" ]]; then
  GGSA_OSA_ARCHIVE_URL="$(oci_metadata_value ggsa_osa_archive_url || true)"
fi
if [[ -z "${GGSA_OSA_ARCHIVE_URL:-}" ]]; then
  printf 'GGSA_OSA_ARCHIVE_URL is required in %s or OCI metadata key ggsa_osa_archive_url.\n' "${ENV_FILE}" >&2
  exit 1
fi
export GGSA_OSA_ARCHIVE_URL

if [[ -z "${GRAVITINO_ICEBERG_REST_SERVER_ARCHIVE_URL:-}" ]]; then
  printf 'GRAVITINO_ICEBERG_REST_SERVER_ARCHIVE_URL is required in %s or OCI metadata key gravitino_iceberg_rest_server_archive_url.\n' "${ENV_FILE}" >&2
  exit 1
fi
export GRAVITINO_ICEBERG_REST_SERVER_ARCHIVE_URL

exec 3>&1
sudo -v
: >"${INSTALL_LOG}"
echo "Installation started $(date -Is)" >>"${INSTALL_LOG}"
exec >>"${INSTALL_LOG}" 2>&1
set -e
trap on_error ERR

## update
progress 1 "Updating operating system"
sudo dnf update -y

## set firewall rules
progress 2 "Configuring firewall"
sudo firewall-cmd --permanent --add-port=1521/tcp #Database
sudo firewall-cmd --permanent --add-port=1522/tcp #NetSuite source database
sudo firewall-cmd --permanent --add-port=8888/tcp #JupyterLabs
sudo firewall-cmd --permanent --add-port=8181/tcp #ORDS
sudo firewall-cmd --permanent --add-port=1525/tcp #Gravitino Iceberg REST API
sudo firewall-cmd --permanent --add-port=8501/tcp #GoldenGate CDC HTTP
sudo firewall-cmd --permanent --add-port=8502/tcp #GoldenGate CDC HTTPS
sudo firewall-cmd --permanent --add-port=8503/tcp #Streamlit
sudo firewall-cmd --permanent --add-port=8504/tcp #Streamlit
sudo firewall-cmd --permanent --add-port=8505/tcp #Streamlit
sudo firewall-cmd --permanent --add-port=5500/tcp #EM
sudo firewall-cmd --permanent --add-port=5501/tcp #EM
sudo firewall-cmd --permanent --add-port=7000/tcp #Django
sudo firewall-cmd --permanent --add-port=27017/tcp #Mongo
sudo firewall-cmd --permanent --add-port=8085/tcp #GGSA OSA HTTPS
sudo firewall-cmd --permanent --add-port=8086/tcp #Sprin2
sudo firewall-cmd --permanent --add-port=8087/tcp #Sprin3
sudo firewall-cmd --permanent --add-port=8088/tcp #Sprin4
sudo firewall-cmd --permanent --add-port=19080/tcp #GGSA OSA HTTP
sudo firewall-cmd --permanent --add-port=9092/tcp #GGSA Kafka
sudo firewall-cmd --permanent --add-port=7077/tcp #GGSA Spark master
sudo firewall-cmd --permanent --add-port=28080/tcp #GGSA Spark master UI
sudo firewall-cmd --permanent --add-port=28081/tcp #GGSA Spark worker UI
sudo firewall-cmd --permanent --add-port=28082/tcp #GGSA Spark worker UI
sudo firewall-cmd --permanent --add-port=28083/tcp #GGSA Spark history UI
sudo firewall-cmd --permanent --add-port=6066/tcp #GGSA Spark REST
sudo firewall-cmd --permanent --add-port=4040-4050/tcp #GGSA Spark app UI

sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" destination address="10.0.0.0/24" service name="ssh" accept'
sudo firewall-cmd --reload

#expand boot volume (https://docs.oracle.com/en-us/iaas/oracle-linux/oci-utils/index.htm#oci-growfs)
progress 3 "Expanding boot volume"
sudo /usr/libexec/oci-growfs -y

#podman and utensils - https://docs.oracle.com/en/operating-systems/oracle-linux/podman/podman-InstallingPodmanandRelatedUtilities.html
progress 4 "Installing system packages"
sudo dnf install -y oracle-epel-release-el9
sudo dnf config-manager --enable ol9_developer_EPEL
sudo dnf install -y container-tools sqlcl jdk-26-headless wget git openssl
sudo dnf install -y podman-compose
sudo dnf -y install oraclelinux-developer-release-el9
sudo dnf -y install python39-oci-cli python3.9-pip
# sudo dnf -y install maven

progress 5 "Installing Python tools"
sudo dnf install -y python3.11 python3.11-pip

sudo pip3.11 install oracledb dotenv requests

sudo pip3.11 install --upgrade podman-compose

progress 6 "Authenticating container registry"
exec 1>&3 2>&3
echo
if [[ -n "${CON_USER:-}" && -n "${CON_TOK:-}" ]]; then
  echo "Logging in to container-registry.oracle.com using CON_USER and CON_TOK."
  if ! printf '%s' "${CON_TOK}" \
    | podman login --username "${CON_USER}" --password-stdin container-registry.oracle.com; then
    exec >>"${INSTALL_LOG}" 2>&1
    unset CON_TOK
    printf '\nInstallation failed during: %s\nDetailed output: %s\n' "${CURRENT_LABEL}" "${INSTALL_LOG}" >&3
    exit 1
  fi
else
  if [[ -n "${CON_USER:-}" || -n "${CON_TOK:-}" ]]; then
    echo "Both CON_USER and CON_TOK are required for automatic registry login."
  fi
  echo "Log in to container-registry.oracle.com with your Oracle email address and auth token."
  if ! podman login container-registry.oracle.com; then
    exec >>"${INSTALL_LOG}" 2>&1
    unset CON_TOK
    printf '\nInstallation failed during: %s\nDetailed output: %s\n' "${CURRENT_LABEL}" "${INSTALL_LOG}" >&3
    exit 1
  fi
fi
unset CON_TOK
exec >>"${INSTALL_LOG}" 2>&1

#set up user and group for podman
progress 7 "Configuring Podman"
sudo loginctl enable-linger 'opc'
sudo setsebool -P container_manage_cgroup on

#git clone the compose sources to be added
#git clone --recurse-submodules --depth 1 git@github.com:oracle-livelabs/demo-code.git compose2cloud


#aliases (source manually for now)
# mkdir -p ~/.config/jambo
# chmod +x /home/opc/init/alias.sh
# cp /home/opc/init/alias.sh ~/.config/jambo/.

echo "alias check='watch systemctl --user status user-podman.service'" >> ~/.bash_profile
echo "alias stopp='systemctl --user stop user-podman.service'" >> ~/.bash_profile
echo "alias cleanup='systemctl --user stop user-podman.service && rm -rf compose2cloud/ ; rm -rf .config/systemd/user/ ; rm -rf .oci ; podman stop jupyterlab ; podman stop demo ; buildah rm --all ; podman system prune --all --force ;rm -rf ~/tmp ; systemctl --user daemon-reload'" >> ~/.bash_profile

source ~/.bash_profile


## Generic own-tenancy installs must not use a shared LiveLabs bootstrap or its
## environment-specific hostnames. LiveLabs builds opt in with an explicit URL.
if is_enabled "${ENABLE_LIVELABS_FIRSTBOOT:-false}"; then
  if [[ -z "${LIVELABS_FIRSTBOOT_URL:-}" ]]; then
    printf 'LIVELABS_FIRSTBOOT_URL is required when ENABLE_LIVELABS_FIRSTBOOT is enabled.\n' >&2
    exit 1
  fi
  progress 8 "Applying LiveLabs configuration"
  wget -O /home/opc/firstboot.sh "${LIVELABS_FIRSTBOOT_URL}"
  sudo bash /home/opc/firstboot.sh
  chmod +x /home/opc/firstboot.sh
  sudo ln -sf /home/opc/firstboot.sh /var/lib/cloud/scripts/per-instance/firstboot.sh
  sudo /var/lib/cloud/scripts/per-instance/firstboot.sh
else
  progress 8 "Skipping LiveLabs configuration"
fi

## load variables (scripts, passwords, etc)
# source /home/opc/init/variable.sh
# chmod +x /home/opc/init/*.sh

## create the compose script folder and files
mkdir -p /home/opc/.config/systemd/user

##############################################
#### U P D A T E      U R L              ####
##############################################
## update the url to build.zip
################################################ 
## this should point to the custom service file for your workshop

progress 9 "Downloading and extracting application files"
wget -O /home/opc/build_dev.zip "${BUILD_ARCHIVE_URL}"
unzip -oq /home/opc/build_dev.zip -d /home/opc/
rm /home/opc/build_dev.zip

# AI Hub is selected when this custom image is built. Persist only this
# non-secret boolean so VMs created from the image do not need Terraform
# metadata or a runtime .env setting to make the same selection.
AIHUB_IMAGE_DEFAULT_FILE="/home/opc/init/aihub-image-default.env"
AIHUB_IMAGE_DEFAULT=false
if is_enabled "${AIHUB:-false}"; then
  AIHUB_IMAGE_DEFAULT=true
fi
AIHUB_IMAGE_DEFAULT_TMP="${AIHUB_IMAGE_DEFAULT_FILE}.tmp"
printf 'AIHUB=%s\n' "${AIHUB_IMAGE_DEFAULT}" > "${AIHUB_IMAGE_DEFAULT_TMP}"
chmod 600 "${AIHUB_IMAGE_DEFAULT_TMP}"
mv -f "${AIHUB_IMAGE_DEFAULT_TMP}" "${AIHUB_IMAGE_DEFAULT_FILE}"
unset AIHUB_IMAGE_DEFAULT AIHUB_IMAGE_DEFAULT_FILE AIHUB_IMAGE_DEFAULT_TMP

OSA_ARCHIVE_NAME="${GGSA_OSA_ARCHIVE:-V1054826-01.zip}"
OSA_ARCHIVE_URL="${GGSA_OSA_ARCHIVE_URL}"
OSA_ARCHIVE_DIR="/home/opc/ingestion/ggsa"
OSA_ARCHIVE_PATH="${OSA_ARCHIVE_DIR}/${OSA_ARCHIVE_NAME}"
OSA_ARCHIVE_TMP="/tmp/${OSA_ARCHIVE_NAME}.$$"

progress 10 "Preparing GoldenGate installer"
mkdir -p "${OSA_ARCHIVE_DIR}"
if [ ! -s "${OSA_ARCHIVE_PATH}" ]; then
  wget -O "${OSA_ARCHIVE_TMP}" "${OSA_ARCHIVE_URL}" \
    && mv "${OSA_ARCHIVE_TMP}" "${OSA_ARCHIVE_PATH}" \
    && chmod 644 "${OSA_ARCHIVE_PATH}" \
    || { rm -f "${OSA_ARCHIVE_TMP}"; echo "Failed to download OSA installer archive."; exit 1; }
fi

GRAVITINO_ARCHIVE_NAME="${GRAVITINO_ICEBERG_REST_SERVER_ARCHIVE:-gravitino-iceberg-rest-server-0.7.0-incubating-SNAPSHOT-bin.zip}"
GRAVITINO_ARCHIVE_URL="${GRAVITINO_ICEBERG_REST_SERVER_ARCHIVE_URL}"
GRAVITINO_ARCHIVE_DIR="/home/opc/ingestion/gravitino/dist"
GRAVITINO_ARCHIVE_PATH="${GRAVITINO_ARCHIVE_DIR}/${GRAVITINO_ARCHIVE_NAME}"
GRAVITINO_ARCHIVE_TMP="/tmp/${GRAVITINO_ARCHIVE_NAME}.$$"

progress 10 "Preparing Gravitino Iceberg REST server"
mkdir -p "${GRAVITINO_ARCHIVE_DIR}"
if [ ! -s "${GRAVITINO_ARCHIVE_PATH}" ]; then
  if [ -f "${GRAVITINO_ARCHIVE_URL}" ]; then
    cp "${GRAVITINO_ARCHIVE_URL}" "${GRAVITINO_ARCHIVE_TMP}" \
      && mv "${GRAVITINO_ARCHIVE_TMP}" "${GRAVITINO_ARCHIVE_PATH}" \
      && chmod 644 "${GRAVITINO_ARCHIVE_PATH}" \
      || { rm -f "${GRAVITINO_ARCHIVE_TMP}"; echo "Failed to stage Gravitino archive."; exit 1; }
  else
    wget -O "${GRAVITINO_ARCHIVE_TMP}" "${GRAVITINO_ARCHIVE_URL}" \
      && mv "${GRAVITINO_ARCHIVE_TMP}" "${GRAVITINO_ARCHIVE_PATH}" \
      && chmod 644 "${GRAVITINO_ARCHIVE_PATH}" \
      || { rm -f "${GRAVITINO_ARCHIVE_TMP}"; echo "Failed to download Gravitino archive."; exit 1; }
  fi
fi

cp /home/opc/init/user-podman.service /home/opc/.config/systemd/user/.
cp /home/opc/init/adb-wallet.service /home/opc/.config/systemd/user/.
cp /home/opc/init/adb-load.service /home/opc/.config/systemd/user/.
cp /home/opc/init/pg-iceberg-connection.service /home/opc/.config/systemd/user/.
cp /home/opc/init/iceberg-seed.service /home/opc/.config/systemd/user/.
chmod +x /home/opc/init/create-iceberg-adb-external-table.sh
##########
##########

progress 11 "Configuring application services"
mkdir -p /home/opc/ingestion/oradata
mkdir -p /home/opc/ingestion/dmdump

chmod 700 /home/opc/ingestion/oradata
chmod 700 /home/opc/ingestion/dmdump

progress 11 "Building offline Iceberg seeder image"
(
  cd /home/opc/ingestion
  /usr/local/bin/podman-compose -f compose.yml --profile seed build iceberg-seeder
)

progress 12 "Starting application services"
sudo systemctl daemon-reload
export XDG_RUNTIME_DIR=/run/user/$UID
systemctl --user daemon-reload
systemctl --user enable user-podman
systemctl --user enable pg-iceberg-connection.service
systemctl --user enable iceberg-seed.service
systemctl --user start user-podman
systemctl --user start --no-block pg-iceberg-connection.service
systemctl --user start --no-block iceberg-seed.service

printf '\nInstallation complete.Detailed output: %s\n' "${INSTALL_LOG}" >&3

printf '\nContainer stack is being deployed now. Check progress using systemctl --user status user-podman.service, systemctl --user status pg-iceberg-connection.service, and systemctl --user status iceberg-seed.service'

#######    E N D      S C R I P T    ######
