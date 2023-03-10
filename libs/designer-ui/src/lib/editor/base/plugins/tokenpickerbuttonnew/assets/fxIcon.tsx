interface IconProps {
  fill: string;
}
export function FxIcon({ fill }: IconProps): JSX.Element {
  return (
    <svg version="1.1" viewBox="0 0 34 34" xmlns="http://www.w3.org/2000/svg">
      <path
        fill={fill}
        d="M13.114,13.248a7.054,7.054,0,0,1,1.849-3.69A5.3,5.3,0,0,1,18.219,7.9c.985,0,1.467.585,1.447,1.069a1.551,1.551,0,0,1-.744,1.149.406.406,0,0,1-.543-.061c-.543-.665-1.005-1.069-1.367-1.069-.4-.02-.764.282-1.407,4.255h2.332l-.422.807-2.09.161c-.342,1.835-.6,3.63-1.146,5.908-.784,3.327-1.688,4.658-3.1,5.827A3.746,3.746,0,0,1,8.973,27c-.663,0-1.347-.444-1.347-.968a1.692,1.692,0,0,1,.724-1.149c.161-.121.281-.141.422-.04a2.873,2.873,0,0,0,1.568.706.675.675,0,0,0,.663-.5,27.427,27.427,0,0,0,.844-4.174c.462-2.762.744-4.658,1.085-6.654H11.325l-.1-.2.683-.766Z"
      />
      <path
        fill={fill}
        d="M16.947,18.9c.812-1.183,1.654-1.874,2.236-1.874.49,0,.735.522,1.057,1.49l.23.722c1.164-1.675,1.731-2.212,2.4-2.212a.742.742,0,0,1,.751.845.922.922,0,0,1-.8.876.414.414,0,0,1-.291-.169.477.477,0,0,0-.368-.184c-.153,0-.337.108-.613.384a8.547,8.547,0,0,0-.873,1.075l.613,1.966c.184.63.367.952.567.952.184,0,.506-.246,1.042-.891l.322.384c-.9,1.429-1.761,1.92-2.343,1.92-.521,0-.858-.43-1.18-1.49l-.352-1.168c-1.179,1.92-1.746,2.658-2.543,2.658A.815.815,0,0,1,16,23.309a.9.9,0,0,1,.766-.922.493.493,0,0,1,.291.154.514.514,0,0,0,.368.169c.337,0,.95-.676,1.715-1.859l-.4-1.367c-.276-.906-.414-1.014-.567-1.014-.138,0-.414.2-.888.814Z"
      />
    </svg>
  );
}